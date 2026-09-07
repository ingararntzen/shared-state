import asyncio
import websockets
import websockets.exceptions
import json
import http
import traceback
import importlib
import logging
import mimetypes
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse, unquote
from typing import Any, Dict
from sharedstate.ss_clock import MonotonicWallClock


DEFAULT_CONFIG = {
    "service": {
        "host": "0.0.0.0",
        "port": 9000,
        "http_log": "logs/http.log",
        "ws_log": "logs/ws.log"
    },
    "stores": [
        {
            "name": "items",
            "module": "items_store",
            "description": "SQLite In-Memory Item Store",
            "config": {
                "db_type": "sqlite",
                "db_name": ":memory:",
                "db_table": "items"
            }
        }
    ]
}


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


async def serve_with_port_fallback(handler, host, port, process_request=None, loggers=None, max_attempts=100):
    """Attempts to bind a websockets server to the requested port, searching subsequent ports if in use."""
    bound_server = None
    actual_port = port

    for offset in range(max_attempts):
        try_port = port + offset
        try:
            bound_server = await websockets.serve(
                handler,
                host,
                try_port,
                process_request=process_request
            )
            actual_port = try_port
            if try_port != port:
                port_warn = f"SharedState: Requested port {port} in use. Automatically bound to port {try_port}."
                print(port_warn)
                if loggers:
                    for lgr in loggers:
                        if lgr:
                            lgr.warning(port_warn)
            break
        except OSError as e:
            # EADDRINUSE: errno 98 on Linux, 48 on macOS, 10048 on Windows
            if getattr(e, 'errno', None) in (98, 48, 10048) or "address already in use" in str(e).lower():
                continue
            raise

    if bound_server is None:
        raise OSError(f"SharedState: Could not bind to any port in range {port}-{port + max_attempts - 1}")

    return bound_server, actual_port


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

    def __init__(self, port=9000, host="0.0.0.0", stores=[],
                 http_log="logs/http.log", ws_log="logs/ws.log", html_dir=None):
        self._host = host
        self._port = port

        self._http_log_path = http_log
        self._ws_log_path = ws_log
        
        self._ws_server = None
        self._stop_event = None

        # Root directory for serving static HTML/JS assets
        self._html_dir = Path(html_dir) if html_dir else Path(__file__).resolve().parent.parent.parent / "html"
        self._dist_dir = self._html_dir.parent / "dist"
        self._client_dir = self._html_dir.parent / "client"

        # Setup loggers
        self.http_logger = setup_logger("sharedstate_http", self._http_log_path)
        self.ws_logger = setup_logger("sharedstate_ws", self._ws_log_path)

        # server clock (using MonotonicWallClock)
        self._clock = MonotonicWallClock()

        # client subscriptions
        self._clients = Clients()

        # processing tasks
        self._tasks = []

        # item stores
        self._stores = {}
        self._store_meta = []

        for store in stores:
            module_path = f"sharedstate.stores.{store['module']}"
            module = importlib.import_module(module_path)
            store_obj = module.get_store(store.get("config", {}))
            
            self._stores[store['name']] = store_obj
            self._store_meta.append({
                "name": store['name'],
                "module": store['module'],
                "description": store.get("description", f"{store['module']} store")
            })

        self.ws_logger.info(f"Loaded stores: {list(self._stores.keys())}")

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
                req_data = msg.get("data") if "data" in msg else msg.get("arg")
                ok, result = await self.handle_PUT(ws, msg["path"], req_data, tunnel=msg.get("tunnel"))

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

    async def _process_unicast_reset(self, ws, path, changes, tunnel=None):
        msg = {
            "type": MsgType.MESSAGE,
            "cmd": MsgCmd.NOTIFY,
            "path": path,
            "data": changes,
            "tunnel": tunnel
        }
        await self._send(ws, json.dumps(msg))

    async def _process_multicast_notify(self, path, changes, tunnel=None):
        msg = {
            "type": MsgType.MESSAGE,
            "cmd": MsgCmd.NOTIFY,
            "path": path,
            "data": changes,
            "tunnel": tunnel
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
            return True, list(self._stores.keys())

        if n_path == PurePosixPath("/subs"):
            return True, self._clients.get_subs(ws)

        if n_path == PurePosixPath("/clock"):
            return True, self._clock.now()

        # /resources/app/store/resource OR /app/store/resource
        parts = n_path.parts[1:]
        if parts and parts[0] == "resources":
            parts = parts[1:]
        if len(parts) >= 3:
            app, store_name, resource = parts[0], parts[1], parts[2]
            store = self._stores.get(store_name, None)
            if store is None:
                return False, "no store"
            else:
                return True, await store.get(app, resource)
        return False, "invalid path"

    async def handle_PUT(self, ws, path, changes, tunnel=None):
        parsed_url = urlparse(path)
        n_path = normalize(parsed_url.path)
        path_str = str(n_path)

        if n_path == PurePosixPath("/subs"):
            subs = changes.get("insert", [])
            self._clients.put_subs(ws, subs)
            for sub_path, sub_opts in subs:
                if self._clients.is_subscribed_to_path(ws, sub_path):
                    ok, result = await self.handle_GET(ws, sub_path)
                    if ok:
                        sub_n_path = normalize(sub_path)
                        parts = sub_n_path.parts[1:]
                        if parts and parts[0] == "resources":
                            parts = parts[1:]
                        version = 0
                        if len(parts) >= 3:
                            app, store_name, resource = parts[0], parts[1], parts[2]
                            st = self._stores.get(store_name)
                            if st and hasattr(st, "get_version"):
                                version = await st.get_version(app, resource)
                        reset_changes = {"remove": [], "insert": result, "reset": True, "version": version}
                        self._tasks.append(("unicast_reset", ws, sub_path, reset_changes, tunnel))
            return True, self._clients.get_subs(ws)

        parts = n_path.parts[1:]
        if parts and parts[0] == "resources":
            parts = parts[1:]
        if len(parts) >= 3:
            app, store_name, resource = parts[0], parts[1], parts[2]
            store = self._stores.get(store_name, None)
            if store is None:
                return False, "no store"
            ok, result = await store.update(app, resource, changes)
            if not ok:
                return False, result
            eff_changes = result
            self._tasks.append(("multicast_notify", path_str, eff_changes, tunnel))
            total_items = len(eff_changes.get("insert", [])) + len(eff_changes.get("remove", []))
            return True, total_items
        return False, "invalid path"

    ####################################################################
    # HTTP REST & STATIC ASSET SERVER
    ####################################################################

    async def _process_http_request(self, path, headers):
        """Process incoming HTTP requests before WebSocket handshake."""
        upgrade_header = headers.get("Upgrade", "").lower() if hasattr(headers, "get") else ""
        if upgrade_header == "websocket":
            return None  # Pass to websockets for WS handshake

        method = "GET"
        parsed = urlparse(path)
        clean_path = unquote(parsed.path)

        self.http_logger.info(f"{method} {clean_path}")

        status_code, content_type, body_bytes, extra_headers = await self._route_http_request(clean_path)

        resp_headers = [
            ("Content-Type", content_type),
            ("Content-Length", str(len(body_bytes))),
            ("Access-Control-Allow-Origin", "*"),
            ("Connection", "close")
        ]
        if extra_headers:
            resp_headers.extend(extra_headers)

        return (http.HTTPStatus(status_code), resp_headers, body_bytes)

    async def _route_http_request(self, path_str):
        n_path = normalize(path_str)
        parts = [p for p in n_path.parts if p != '/']

        # 1. API Route Namespace: /api/... ONLY
        if parts and parts[0] == 'api':
            api_parts = parts[1:]

            if api_parts == ['config']:
                cfg_data = {
                    "host": self._host,
                    "port": self._port,
                    "http_log": str(self._http_log_path),
                    "ws_log": str(self._ws_log_path),
                    "stores": self._store_meta
                }
                return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": cfg_data}).encode('utf-8'), []

            if api_parts == ['clock']:
                now_ts = self._clock.now()
                return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": now_ts}).encode('utf-8'), []

            if api_parts == ['stores']:
                res = []
                for store_name, store in self._stores.items():
                    meta = next((s for s in self._store_meta if isinstance(s, dict) and s.get("name") == store_name), {}) if isinstance(self._store_meta, list) else {}
                    desc = meta.get("description", "")
                    apps_count = 0
                    resources_count = 0
                    if hasattr(store, 'apps'):
                        apps = await store.apps()
                        apps_count = len(apps)
                        for app in apps:
                            if hasattr(store, 'resources'):
                                resources = await store.resources(app)
                                resources_count += len(resources)
                    res.append({
                        "name": store_name,
                        "path": f"/api/stores/{store_name}",
                        "description": desc,
                        "apps": apps_count,
                        "resources": resources_count
                    })
                return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": res}).encode('utf-8'), []

            if api_parts == ['subs']:
                return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": self._clients.all_subs_summary()}).encode('utf-8'), []

            if api_parts == ['connections']:
                conns = [str(ws.remote_address) for ws in self._clients.all_clients() if hasattr(ws, 'remote_address')]
                return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": conns}).encode('utf-8'), []

            # GET /api/apps/...
            if api_parts and api_parts[0] == 'apps':
                if len(api_parts) == 1:
                    app_map = {}
                    for store in self._stores.values():
                        if hasattr(store, 'apps'):
                            apps = await store.apps()
                            for app in apps:
                                if app not in app_map:
                                    app_map[app] = 0
                                if hasattr(store, 'resources'):
                                    resources = await store.resources(app)
                                    app_map[app] += len(resources)

                    res = []
                    for app_name in sorted(app_map.keys()):
                        res.append({
                            "name": app_name,
                            "path": f"/api/apps/{app_name}",
                            "resources": app_map[app_name]
                        })
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": res}).encode('utf-8'), []

                app_name = api_parts[1]

                if len(api_parts) == 2:
                    app_tree = {}
                    for store_name, store in self._stores.items():
                        if hasattr(store, 'apps'):
                            apps = await store.apps()
                            if app_name in apps:
                                app_tree[store_name] = []
                                if hasattr(store, 'resources'):
                                    resources = await store.resources(app_name)
                                    for res_item in resources:
                                        items = await store.get(app_name, res_item)
                                        app_tree[store_name].append({"name": res_item, "count": len(items)})
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": app_tree}).encode('utf-8'), []

                if len(api_parts) == 3:
                    store_name = api_parts[2]
                    store = self._stores.get(store_name)
                    if not store:
                        return 404, "application/json", json.dumps({"ok": False, "error": f"no store '{store_name}'"}).encode('utf-8'), []
                    if hasattr(store, 'resources'):
                        resources = await store.resources(app_name)
                        return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": resources}).encode('utf-8'), []
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": []}).encode('utf-8'), []

                if len(api_parts) == 4:
                    store_name, chnl_name = api_parts[2], api_parts[3]
                    store = self._stores.get(store_name)
                    if not store:
                        return 404, "application/json", json.dumps({"ok": False, "error": f"no store '{store_name}'"}).encode('utf-8'), []
                    items = await store.get(app_name, chnl_name)
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": items}).encode('utf-8'), []

            # GET /api/stores/...
            if api_parts and api_parts[0] == 'stores':
                store_name = api_parts[1] if len(api_parts) > 1 else None
                store = self._stores.get(store_name) if store_name else None

                if not store:
                    return 404, "application/json", json.dumps({"ok": False, "error": f"no store '{store_name}'"}).encode('utf-8'), []

                if len(api_parts) == 2:
                    if hasattr(store, 'apps'):
                        apps = await store.apps()
                        return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": apps}).encode('utf-8'), []
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": []}).encode('utf-8'), []

                if len(api_parts) == 3:
                    app_name = api_parts[2]
                    if hasattr(store, 'resources'):
                        resources = await store.resources(app_name)
                        return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": resources}).encode('utf-8'), []
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": []}).encode('utf-8'), []

                if len(api_parts) == 4:
                    app_name, chnl_name = api_parts[2], api_parts[3]
                    items = await store.get(app_name, chnl_name)
                    return 200, "application/json; charset=utf-8", json.dumps({"ok": True, "data": items}).encode('utf-8'), []

            return 404, "application/json", json.dumps({"ok": False, "error": "API route not found"}).encode('utf-8'), []

        # 2. Root Redirect: / or /index.html -> HTTP 302 Redirect to /files/adm/index.html
        if not parts or parts == ['index.html']:
            return 302, "text/html; charset=utf-8", b"", [("Location", "/files/adm/index.html")]

        # 3. Built Client SDK Bundles (/dist/*)
        if parts and parts[0] == 'dist':
            rel_path = "/".join(parts[1:])
            dist_file = (self._dist_dir / rel_path).resolve()
            if dist_file.exists() and dist_file.is_file() and str(dist_file).startswith(str(self._dist_dir.resolve())):
                content_type, _ = mimetypes.guess_type(str(dist_file))
                content_type = content_type or "application/javascript; charset=utf-8"
                return 200, content_type, dist_file.read_bytes(), []

        # 4. Source Client SDK Files (/client/*)
        if parts and parts[0] == 'client':
            rel_path = "/".join(parts[1:])
            client_file = (self._client_dir / rel_path).resolve()
            if client_file.exists() and client_file.is_file() and str(client_file).startswith(str(self._client_dir.resolve())):
                content_type, _ = mimetypes.guess_type(str(client_file))
                content_type = content_type or "application/javascript; charset=utf-8"
                return 200, content_type, client_file.read_bytes(), []

        # 4. Static Files (/files/*)
        if parts and parts[0] == 'files':
            rel_path = "/".join(parts[1:])
            static_file = (self._html_dir / rel_path).resolve()
            if static_file.exists() and str(static_file).startswith(str(self._html_dir.resolve())):
                if static_file.is_file():
                    content_type, _ = mimetypes.guess_type(str(static_file))
                    return 200, content_type or "application/octet-stream", static_file.read_bytes(), []
                elif static_file.is_dir():
                    index_file = static_file / "index.html"
                    if index_file.exists() and index_file.is_file() and rel_path != "":
                        content_type, _ = mimetypes.guess_type(str(index_file))
                        return 200, content_type or "text/html; charset=utf-8", index_file.read_bytes(), []
                    return self._render_directory_listing(static_file, path_str)

        return self._render_404_page(path_str)

    def _render_404_page(self, req_path):
        """Render a minimal HTML 404 Not Found page."""
        display_path = unquote(req_path)
        html_content = f"<!DOCTYPE html><html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1><p>The requested URL {display_path} was not found on this server.</p></body></html>"
        return 404, "text/html; charset=utf-8", html_content.encode('utf-8'), []

    def _render_directory_listing(self, dir_path, req_path):
        """Render a minimal HTML directory listing."""
        display_path = unquote(req_path)
        if not display_path.endswith('/'):
            display_path += '/'

        entries = sorted(dir_path.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        lines = [f'<!DOCTYPE html><html><head><title>Index of {display_path}</title></head><body><h1>Index of {display_path}</h1><hr><pre>']

        clean_req = req_path.rstrip('/')
        if clean_req != '/files' and clean_req != '':
            lines.append('<a href="../">../</a>')

        for entry in entries:
            name = entry.name
            if name.startswith('.'):
                continue
            is_dir = entry.is_dir()
            href = f"{name}/" if is_dir else name
            lines.append(f'<a href="{href}">{name}{"/" if is_dir else ""}</a>')

        lines.append('</pre><hr></body></html>')
        return 200, "text/html; charset=utf-8", "\n".join(lines).encode('utf-8'), []

    ####################################################################
    # RUN & LIFECYCLE
    ####################################################################

    async def serve_forever(self):
        self._stop_event = asyncio.Event()
        for store_obj in self._stores.values():
            await store_obj.open()

        self._ws_server, self._port = await serve_with_port_fallback(
            self._handle_ws_client,
            self._host,
            self._port,
            process_request=self._process_http_request,
            loggers=[self.http_logger, self.ws_logger]
        )

        startup_msg = f"SharedState: Server listening at http://{self._host}:{self._port} (HTTP & WebSockets)"
        print(startup_msg)
        self.http_logger.info(startup_msg)
        self.ws_logger.info(startup_msg)

        await self._stop_event.wait()

    async def shutdown(self):
        shutdown_msg = "SharedState: Server shutting down..."
        print(shutdown_msg)
        self.http_logger.info(shutdown_msg)
        self.ws_logger.info(shutdown_msg)

        for ws in list(self._clients.all_clients()):
            await ws.close()
        for store_obj in self._stores.values():
            await store_obj.close()

        if self._ws_server:
            self._ws_server.close()
            await self._ws_server.wait_closed()

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
    parser.add_argument('config', type=str, nargs='?', default=None, help='Path to the configuration file (JSON). Defaults to in-memory SQLite configuration.')
    args = parser.parse_args()

    config = None
    if args.config:
        config_path = Path(args.config)
        if not config_path.is_file():
            print(f"Error: Config file '{args.config}' not found.")
            return
        with open(config_path, "r", encoding="utf-8") as f:
            config = json.load(f)
    else:
        config = DEFAULT_CONFIG
        print("SharedState: No config file specified. Using default in-memory SQLite configuration.")

    raw_service = config.get("service")
    srv_cfg: dict = raw_service if isinstance(raw_service, dict) else {}

    raw_stores = config.get("stores")
    stores: list = raw_stores if isinstance(raw_stores, list) else []

    host = str(srv_cfg.get("host", "0.0.0.0"))
    port = int(srv_cfg.get("port", 9000))
    http_log = srv_cfg.get("http_log", "logs/http.log")
    ws_log = srv_cfg.get("ws_log", "logs/ws.log")

    server = SharedStateServer(
        host=host,
        port=port,
        http_log=http_log,
        ws_log=ws_log,
        stores=stores
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


