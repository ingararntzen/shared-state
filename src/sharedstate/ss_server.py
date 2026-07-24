import asyncio
import websockets
import json
import traceback
import importlib
import logging
import mimetypes
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse, unquote
from datetime import datetime, timezone


def normalize(path):
    n_path = PurePosixPath(path)
    if not n_path.is_absolute():
        n_path = PurePosixPath(f"/{path}")
    return n_path


from logging.handlers import RotatingFileHandler


def setup_logger(name, log_file, level=logging.INFO):
    """Setup logger with rotating file handler (max ~1024 entries / 100 KB)."""
    logger = logging.getLogger(name)
    logger.setLevel(level)
    logger.propagate = False
    
    # Remove and close any existing handlers to prevent log bleeding across instances/tests
    for h in list(logger.handlers):
        logger.removeHandler(h)
        h.close()
        
    if log_file:
        log_path = Path(log_file)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        # Limit log file size to ~100 KB (~1024 log lines) with 1 backup, appending to existing log
        handler = RotatingFileHandler(log_path, mode='a', maxBytes=100_000, backupCount=1, encoding="utf-8")
    else:
        handler = logging.NullHandler()
        
    formatter = logging.Formatter('%(asctime)s [%(levelname)s] %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    return logger


########################################################################
# Messages
########################################################################

class MsgType:
    """Message types used by server and client."""
    MESSAGE = "MESSAGE"
    REQUEST = "REQUEST"
    REPLY = "REPLY"


class MsgCmd:
    """Message commands used by server and client."""
    GET = "GET"
    PUT = "PUT"
    NOTIFY = "NOTIFY"


########################################################################
# CLIENTS
########################################################################

class Clients:

    def __init__(self):
        # websocket -> {path -> subscription}
        self._map = {}

    def register(self, ws):
        """Register client. No subscriptions"""
        if ws not in self._map:
            self._map[ws] = {}

    def unregister(self, ws):
        """Unregister client. Clear subscriptions"""
        if ws in self._map:
            del self._map[ws]

    def all_clients(self):
        return list(self._map.keys())

    def get_subs(self, ws):
        """GET subscriptions of client [(path, sub), ...]"""
        return list(self._map.get(ws, {}).items())

    def put_subs(self, ws, subs):
        """PUT subscriptions for client subs: [(path, sub)]"""
        self._map[ws] = dict(subs)

    def clients(self, path):
        """Get all clients subscribed to path"""
        res = []
        for ws, sub_map in self._map.items():
            if path in sub_map:
                res.append(ws)
        return res

    def is_subscribed_to_path(self, ws, path):
        """Return true if websocket is subscribed to path."""
        return self._map.get(ws, None) is not None

    def all_subs_summary(self):
        """Return summary of all active client subscriptions."""
        subs = []
        for ws, sub_map in self._map.items():
            addr = str(ws.remote_address) if hasattr(ws, 'remote_address') else "unknown"
            for path, sub in sub_map.items():
                subs.append({"client": addr, "path": path, "options": sub})
        return subs


########################################################################
# SharedState Server
########################################################################

class SharedStateServer:

    def __init__(self, http_port=9000, ws_port=9001, host="0.0.0.0", services=[],
                 http_log="logs/http.log", ws_log="logs/ws.log", html_dir=None):
        self._host = host
        self._http_port = http_port
        self._ws_port = ws_port
        self._http_log_path = http_log
        self._ws_log_path = ws_log
        
        self._http_server = None
        self._ws_server = None
        self._stop_event = None

        # Root directory for serving static HTML/JS assets
        self._html_dir = Path(html_dir) if html_dir else Path(__file__).resolve().parent.parent.parent / "html"

        # Setup loggers
        self.http_logger = setup_logger("sharedstate_http", self._http_log_path)
        self.ws_logger = setup_logger("sharedstate_ws", self._ws_log_path)

        # client subscriptions
        self._clients = Clients()

        # processing tasks
        self._tasks = []

        # services
        self._services = {}
        self._service_meta = []
        for service in services:
            module_path = f"sharedstate.services.{service['module']}"
            module = importlib.import_module(module_path)
            service_obj = module.get_service(service.get("config", {}))
            self._services[service['name']] = service_obj
            self._service_meta.append({
                "name": service['name'],
                "module": service['module'],
                "description": service.get("description", f"{service['module']} service")
            })

        self.ws_logger.info(f"Loaded services: {list(self._services.keys())}")

    ####################################################################
    # WEBSOCKET HANDLERS & LOGGING
    ####################################################################

    async def _handle_ws_client(self, ws):
        """Handle incoming WebSocket client connection lifecycle."""
        self.on_connect(ws)
        try:
            async for data in ws:
                try:
                    await self.on_message(ws, data)
                except Exception as e:
                    self.ws_logger.error(f"WebSocket Exception: {e}")
                    traceback.print_exc()
        except Exception:
            pass
        finally:
            self.on_disconnect(ws)

    def on_connect(self, ws):
        """Handle client connect."""
        self._clients.register(ws)
        addr = str(ws.remote_address) if hasattr(ws, 'remote_address') else "unknown"
        self.ws_logger.info(f"Connected: {addr}")

    def on_disconnect(self, ws):
        """Handle client disconnect."""
        self._clients.unregister(ws)
        addr = str(ws.remote_address) if hasattr(ws, 'remote_address') else "unknown"
        self.ws_logger.info(f"Disconnected: {addr}")

    async def on_message(self, ws, data):
        """Handle message from client."""
        addr = str(ws.remote_address) if hasattr(ws, 'remote_address') else "unknown"
        self.ws_logger.debug(f"Received from {addr}: {data}")
        msg = json.loads(data)

        if msg['type'] == MsgType.REQUEST:
            ok, result = False, None
            if msg['cmd'] == MsgCmd.GET:
                ok, result = await self.handle_GET(ws, msg["path"])
            elif msg["cmd"] == MsgCmd.PUT:
                ok, result = await self.handle_PUT(ws, msg["path"], msg["arg"])

            reply = {
                "type": MsgType.REPLY,
                "cmd": msg["cmd"],
                "tunnel": msg.get("tunnel"),
                "ok": ok,
                "data": result
            }
            await self._send(ws, json.dumps(reply))
            return await self._process_tasks()

    async def _send(self, ws, data):
        try:
            await ws.send(data)
        except websockets.exceptions.ConnectionClosed as e:
            addr = str(ws.remote_address) if hasattr(ws, 'remote_address') else "unknown"
            self.ws_logger.warning(f"Disconnect on send to {addr}: {e}")
            self._clients.unregister(ws)

    async def _process_tasks(self):
        """Process tasks if any."""
        for task in self._tasks:
            method, *args = task
            if method == "unicast_reset":
                await self._process_unicast_reset(*args)
            elif method == "multicast_notify":
                await self._process_multicast_notify(*args)
        self._tasks = []

    async def _process_unicast_reset(self, ws, paths):
        for path in paths:
            changes = {"remove": [], "insert": [], "reset": True}
            if self._clients.is_subscribed_to_path(ws, path):
                ok, result = await self.handle_GET(ws, path)
                if ok:
                    changes["insert"] = result
            msg = {
                "type": MsgType.MESSAGE,
                "cmd": MsgCmd.NOTIFY,
                "path": path,
                "data": changes
            }
            await self._send(ws, json.dumps(msg))

    async def _process_multicast_notify(self, path, changes, diffs, oldstate_included):
        insert = []
        remove = []
        for diff in diffs:
            if diff["new"] is None:
                remove.append(diff["id"])
            else:
                insert.append(diff["new"])
        changes = {
            "remove": remove,
            "insert": insert,
            "reset": changes.get("reset", False)
        }
        msg = {
            "type": MsgType.MESSAGE,
            "cmd": MsgCmd.NOTIFY,
            "path": path,
            "data": changes
        }
        data = json.dumps(msg)
        for ws in self._clients.clients(path):
            await self._send(ws, data)

    ####################################################################
    # WEBSOCKET REQUEST HANDLERS
    ####################################################################

    async def handle_GET(self, ws, path):
        n_path = normalize(path)

        if n_path == PurePosixPath("/"):
            return True, list(self._services.keys())

        if n_path == PurePosixPath("/subs"):
            return True, self._clients.get_subs(ws)

        if n_path == PurePosixPath("/clock"):
            return True, datetime.now(timezone.utc).timestamp()

        # /app/service/chnl
        parts = n_path.parts[1:]
        if len(parts) >= 3:
            app, service, resource = parts[0], parts[1], parts[2]
            srvc = self._services.get(service, None)
            if srvc is None:
                return False, "no service"
            else:
                return True, await srvc.get(app, resource)
        return False, "invalid path"

    async def handle_PUT(self, ws, path, changes):
        parsed_url = urlparse(path)
        n_path = normalize(parsed_url.path)
        path_str = str(n_path)

        if n_path == PurePosixPath("/subs"):
            subs = changes.get("insert", [])
            self._clients.put_subs(ws, subs)
            reset_paths = [p for p, sub in subs]
            self._tasks.append(("unicast_reset", ws, reset_paths))
            return True, self._clients.get_subs(ws)

        parts = n_path.parts[1:]
        if len(parts) >= 3:
            app, service, chnl = parts[0], parts[1], parts[2]
            srvc = self._services.get(service, None)
            if srvc is None:
                return False, "no service"
            diffs = await srvc.update(app, chnl, changes)
            oldstate_included = getattr(srvc, "oldstate_included", False)
            self._tasks.append(("multicast_notify", path_str, changes, diffs, oldstate_included))
            return True, len(diffs)
        return False, "invalid path"

    ####################################################################
    # HTTP REST & STATIC ASSET SERVER
    ####################################################################

    async def _handle_http_client(self, reader, writer):
        try:
            request_line = await reader.readline()
            if not request_line:
                writer.close()
                await writer.wait_closed()
                return

            req_str = request_line.decode('utf-8', errors='ignore').strip()
            parts = req_str.split(' ')
            if len(parts) < 2:
                writer.close()
                await writer.wait_closed()
                return

            method, raw_path = parts[0], parts[1]
            
            # Read headers until empty line
            while True:
                header_line = await reader.readline()
                if not header_line or header_line == b'\r\n' or header_line == b'\n':
                    break

            peer_addr = writer.get_extra_info('peername')
            client_ip = str(peer_addr[0]) if peer_addr else "unknown"
            self.http_logger.info(f"{client_ip} - {method} {raw_path}")

            parsed = urlparse(raw_path)
            clean_path = unquote(parsed.path)

            if method.upper() != "GET":
                await self._send_http_json(writer, 405, {"ok": False, "error": "Method Not Allowed"})
                return

            await self._route_http_get(writer, clean_path)
        except Exception as e:
            self.http_logger.error(f"HTTP Error: {e}")
            try:
                await self._send_http_json(writer, 500, {"ok": False, "error": str(e)})
            except Exception:
                pass

    async def _route_http_get(self, writer, path_str):
        n_path = normalize(path_str)
        parts = [p for p in n_path.parts if p != '/']

        # 1. Root / Explorer UI
        if not parts or parts == ['index.html']:
            index_file = self._html_dir / "index.html"
            if index_file.exists():
                await self._send_http_file(writer, 200, "text/html; charset=utf-8", index_file.read_bytes())
            else:
                await self._send_http_json(writer, 404, {"ok": False, "error": "index.html not found"})
            return

        # 2. Administrative Diagnostic Endpoints
        if parts == ['config']:
            cfg_data = {
                "host": self._host,
                "http_port": self._http_port,
                "ws_port": self._ws_port,
                "http_log": str(self._http_log_path),
                "ws_log": str(self._ws_log_path),
                "services": self._service_meta
            }
            await self._send_http_json(writer, 200, {"ok": True, "data": cfg_data})
            return

        if parts == ['services']:
            res = []
            for srv_name, srv in self._services.items():
                meta = next((s for s in self._service_meta if isinstance(s, dict) and s.get("name") == srv_name), {}) if isinstance(self._service_meta, list) else {}
                desc = meta.get("description", "")
                apps_count = 0
                resources_count = 0
                if hasattr(srv, 'apps'):
                    apps = await srv.apps()
                    apps_count = len(apps)
                    for app in apps:
                        if hasattr(srv, 'channels'):
                            channels = await srv.channels(app)
                            resources_count += len(channels)
                res.append({
                    "name": srv_name,
                    "path": f"/services/{srv_name}",
                    "description": desc,
                    "apps": apps_count,
                    "resources": resources_count
                })
            await self._send_http_json(writer, 200, {"ok": True, "data": res})
            return

        if parts == ['subs']:
            await self._send_http_json(writer, 200, {"ok": True, "data": self._clients.all_subs_summary()})
            return

        if parts == ['connections']:
            conns = [str(ws.remote_address) for ws in self._clients.all_clients() if hasattr(ws, 'remote_address')]
            await self._send_http_json(writer, 200, {"ok": True, "data": conns})
            return

        # 3. Application-Centric Hierarchy: /apps/...
        if parts[0] == 'apps':
            # GET /apps -> list unique applications with resource counts
            if len(parts) == 1:
                app_map = {}
                for srv in self._services.values():
                    if hasattr(srv, 'apps'):
                        apps = await srv.apps()
                        for app in apps:
                            if app not in app_map:
                                app_map[app] = 0
                            if hasattr(srv, 'channels'):
                                channels = await srv.channels(app)
                                app_map[app] += len(channels)

                res = []
                for app_name in sorted(app_map.keys()):
                    res.append({
                        "name": app_name,
                        "path": f"/apps/{app_name}",
                        "resources": app_map[app_name]
                    })
                await self._send_http_json(writer, 200, {"ok": True, "data": res})
                return

            app_name = parts[1]

            # GET /apps/<app>/ -> detailed resource tree for <app>
            if len(parts) == 2:
                app_tree = {}
                for srv_name, srv in self._services.items():
                    if hasattr(srv, 'apps'):
                        apps = await srv.apps()
                        if app_name in apps:
                            app_tree[srv_name] = []
                            if hasattr(srv, 'channels'):
                                channels = await srv.channels(app_name)
                                for chnl in channels:
                                    items = await srv.get(app_name, chnl)
                                    app_tree[srv_name].append({"name": chnl, "count": len(items)})
                await self._send_http_json(writer, 200, {"ok": True, "data": app_tree})
                return

            # GET /apps/<app>/<service>/ -> list channels under <app>/<service>
            if len(parts) == 3:
                srv_name = parts[2]
                srvc = self._services.get(srv_name)
                if not srvc:
                    await self._send_http_json(writer, 404, {"ok": False, "error": f"no service '{srv_name}'"})
                    return
                if hasattr(srvc, 'channels'):
                    channels = await srvc.channels(app_name)
                    await self._send_http_json(writer, 200, {"ok": True, "data": channels})
                else:
                    await self._send_http_json(writer, 200, {"ok": True, "data": []})
                return

            # GET /apps/<app>/<service>/<chnl> -> list items in collection
            if len(parts) == 4:
                srv_name, chnl_name = parts[2], parts[3]
                srvc = self._services.get(srv_name)
                if not srvc:
                    await self._send_http_json(writer, 404, {"ok": False, "error": f"no service '{srv_name}'"})
                    return
                items = await srvc.get(app_name, chnl_name)
                await self._send_http_json(writer, 200, {"ok": True, "data": items})
                return

        # 4. Service Hierarchy Fallback: /services/<service>/...
        if parts[0] == 'services':
            service_name = parts[1] if len(parts) > 1 else None
            srvc = self._services.get(service_name) if service_name else None

            if service_name and not srvc:
                await self._send_http_json(writer, 404, {"ok": False, "error": f"no service '{service_name}'"})
                return

            # GET /services/<service>/ -> list app names
            if len(parts) == 2:
                if hasattr(srvc, 'apps'):
                    apps = await srvc.apps()
                    await self._send_http_json(writer, 200, {"ok": True, "data": apps})
                else:
                    await self._send_http_json(writer, 200, {"ok": True, "data": []})
                return

            # GET /services/<service>/<app>/ -> list channel/resource names
            if len(parts) == 3:
                app_name = parts[2]
                if hasattr(srvc, 'channels'):
                    channels = await srvc.channels(app_name)
                    await self._send_http_json(writer, 200, {"ok": True, "data": channels})
                else:
                    await self._send_http_json(writer, 200, {"ok": True, "data": []})
                return

            # GET /services/<service>/<app>/<chnl> -> list items in collection
            if len(parts) == 4:
                app_name, chnl_name = parts[2], parts[3]
                items = await srvc.get(app_name, chnl_name)
                await self._send_http_json(writer, 200, {"ok": True, "data": items})
                return

        # 4. Static Asset Files (e.g. /libs/sharedstate.es.js)
        rel_path = path_str.lstrip('/')
        static_file = (self._html_dir / rel_path).resolve()
        if static_file.exists() and static_file.is_file() and str(static_file).startswith(str(self._html_dir.resolve())):
            content_type, _ = mimetypes.guess_type(str(static_file))
            content_type = content_type or "application/octet-stream"
            await self._send_http_file(writer, 200, content_type, static_file.read_bytes())
            return

        await self._send_http_json(writer, 404, {"ok": False, "error": "Not Found"})

    async def _send_http_json(self, writer, status_code, data_obj):
        body_bytes = json.dumps(data_obj).encode('utf-8')
        status_text = {200: "OK", 404: "Not Found", 405: "Method Not Allowed", 500: "Internal Server Error"}.get(status_code, "OK")
        header = (
            f"HTTP/1.1 {status_code} {status_text}\r\n"
            f"Content-Type: application/json; charset=utf-8\r\n"
            f"Content-Length: {len(body_bytes)}\r\n"
            f"Access-Control-Allow-Origin: *\r\n"
            f"Connection: close\r\n\r\n"
        )
        try:
            writer.write(header.encode('utf-8') + body_bytes)
            await writer.drain()
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    async def _send_http_file(self, writer, status_code, content_type, body_bytes):
        header = (
            f"HTTP/1.1 {status_code} OK\r\n"
            f"Content-Type: {content_type}\r\n"
            f"Content-Length: {len(body_bytes)}\r\n"
            f"Access-Control-Allow-Origin: *\r\n"
            f"Connection: close\r\n\r\n"
        )
        try:
            writer.write(header.encode('utf-8') + body_bytes)
            await writer.drain()
        except (ConnectionResetError, BrokenPipeError, OSError):
            pass
        finally:
            try:
                writer.close()
                await writer.wait_closed()
            except Exception:
                pass

    ####################################################################
    # RUN & LIFECYCLE
    ####################################################################

    async def serve_forever(self):
        self._stop_event = asyncio.Event()
        for service in self._services.values():
            await service.open()
            
        self._ws_server = await websockets.serve(self._handle_ws_client, self._host, self._ws_port)
        self._http_server = await asyncio.start_server(self._handle_http_client, self._host, self._http_port)

        # Update bound ports in case port 0 was passed
        if self._ws_server.sockets:
            self._ws_port = self._ws_server.sockets[0].getsockname()[1]
        if self._http_server.sockets:
            self._http_port = self._http_server.sockets[0].getsockname()[1]

        startup_http = f"SharedState: HTTP Admin Listen: http://{self._host}:{self._http_port}"
        startup_ws = f"SharedState: WebSocket Listen:  ws://{self._host}:{self._ws_port}"
        
        print(startup_http)
        print(startup_ws)
        self.http_logger.info(startup_http)
        self.ws_logger.info(startup_ws)

        await self._stop_event.wait()

    async def shutdown(self):
        shutdown_msg = "SharedState: Server shutting down..."
        print(shutdown_msg)
        self.http_logger.info(shutdown_msg)
        self.ws_logger.info(shutdown_msg)

        for ws in list(self._clients.all_clients()):
            await ws.close()
        for service in self._services.values():
            await service.close()

        if self._ws_server:
            self._ws_server.close()
            await self._ws_server.wait_closed()
            
        if self._http_server:
            self._http_server.close()
            await self._http_server.wait_closed()

    def stop(self):
        if self._stop_event:
            self._stop_event.set()


########################################################################
# CLI
########################################################################

async def main():
    import argparse
    import json

    parser = argparse.ArgumentParser(description="SharedState Server")
    parser.add_argument('config', type=str, help='Path to the configuration file (JSON)')
    args = parser.parse_args()

    with open(args.config) as f:
        config = json.load(f)

    srv_cfg = config.get("service", {})
    host = srv_cfg.get("host", "0.0.0.0")
    http_port = int(srv_cfg.get("http_port", srv_cfg.get("port", 9000)))
    ws_port = int(srv_cfg.get("ws_port", 9001))
    http_log = srv_cfg.get("http_log", "logs/http.log")
    ws_log = srv_cfg.get("ws_log", "logs/ws.log")
    services = config.get("services", [])

    server = SharedStateServer(
        host=host,
        http_port=http_port,
        ws_port=ws_port,
        http_log=http_log,
        ws_log=ws_log,
        services=services
    )
    try:
        await server.serve_forever()
    except asyncio.CancelledError:
        await server.shutdown()
    server.stop()


def start():
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    start()
