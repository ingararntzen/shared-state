import asyncio
import websockets
import json
import traceback
import importlib
from pathlib import PurePosixPath


def normalize(path):
    n_path = PurePosixPath(path)
    if not n_path.is_absolute():
        n_path = PurePosixPath(f"/{path}")
    return n_path


########################################################################
# Messages
########################################################################

class MsgType:
    """Message types used by dcserver and dcclient."""
    MESSAGE = "MESSAGE"
    REQUEST = "REQUEST"
    REPLY = "REPLY"


class MsgCmd:
    """Message commands used by dcserver and dcclient."""
    GET = "GET"
    PUT = "PUT"
    DELETE = "DELETE"


########################################################################
# CLIENTS
########################################################################

class Clients:

    def __init__(self):
        # websocket -> {path -> subscription}
        self._map = {}

    ######################################################
    # CONNECTED CLIENTS
    ######################################################

    def register(self, websocket):
        """Register client. No subscriptions"""
        if websocket not in self._map:
            self._map[websocket] = {}

    def unregister(self, websocket):
        """Unregister client. Clear subscriptions"""
        if websocket in self._map:
            del self._map[websocket]

    ######################################################
    # CLIENT SUBSCRIPTIONS
    ######################################################

    def get_subs(self, websocket):
        """
        GET subscriptions of client
        [(path, sub), ...]
        """
        return list(self._map.get(websocket, {}).items())

    def put_subs(self, websocket, subs):
        """
        PUT subscriptions for client
        subs: [(path, sub)]
        empty list clears all subscriptions
        """
        # TODO - calculate diff - removed paths and added paths 
        # old_subs_map = self._map.get(websocket, None)
        self._map[websocket] = dict(subs)

    ######################################################
    # SUBSCTIPTIONS BY PATH
    ######################################################

    def clients(self, path):
        """
        Get all clients subscribed to path
        Return websocket of each client
        """
        res = []
        for websocket, sub_map in self._map.items():
            if path in sub_map:
                res.append(websocket)
        return res

    def get_sub_by_path(self, websocket, path):
        """
        Get subscription of client for given path
        Returns None if no subscription
        """
        return self._map.get(websocket, {}).get(path, None)        

    def is_subscribed_to_path(self, websocket, path):
        """
        Convenience method
        Return true if websocket is subscribed to path.
        """
        return self.get_sub_by_path(websocket, path) is not None


########################################################################
# DataCannon
########################################################################

class DataCannon:

    def __init__(self, port=8000, host="0.0.0.0", services=[]):
        self._host = host
        self._port = port

        # client subscriptions
        self._clients = Clients()

        # services
        self._services = {}
        # load services
        for service in services:
            module_path = f"src.server.services.{service['module']}"
            module = importlib.import_module(module_path)
            service_obj = module.get_service(service.get("config", {}))
            self._services[service['name']] = service_obj

        print(f"DataCannon: Services: {list(self._services.keys())}")

    ####################################################################
    # RUN
    ####################################################################

    async def handler(self, websocket):
        self.on_connect(websocket)
        try:
            async for data in websocket:
                try:
                    await self.on_message(websocket, data)
                except Exception as e:
                    print("Exception", e)
                    traceback.print_exc()
        except websockets.exceptions.ConnectionClosed:
            self.on_disconnect(websocket)

    async def _start_server(self):
        self._stop_event = asyncio.Event()
        async with websockets.serve(self.handler, self._host, self._port):
            await self._stop_event.wait()

    def stop(self):
        self._stop_event.set()

    def serve_forever(self):
        print(f"DataCannon: Listen: ws://{self._host}:{self._port}")
        try:
            asyncio.run(self._start_server())
        except KeyboardInterrupt:
            self.stop()
            print("")
        print("DataCannon: Done")

    ####################################################################
    # HANDLERS
    ####################################################################

    def on_connect(self, websocket):
        """Handle client connect."""
        self._clients.register(websocket)
        print(websocket.remote_address, 'connected')

    def on_disconnect(self, websocket):
        """Handle client diconnect."""
        self._clients.unregister(websocket)
        print(websocket.remote_address, 'disconnected')

    async def on_message(self, websocket, data):
        """Handle message from client."""
        msg = json.loads(data)

        # handles client requests
        if msg['type'] == MsgType.REQUEST:
            ok, result = False, None

            if msg['cmd'] == MsgCmd.GET:
                ok, result = self.handle_GET(websocket, msg)
            elif msg["cmd"] == MsgCmd.PUT:
                ok, result = self.handle_PUT(websocket, msg)
            elif msg["cmd"] == MsgCmd.DELETE:
                ok, result = self.handle_DELETE(websocket, msg)

            reply = {
                "type": MsgType.REPLY,
                "cmd": msg["cmd"],
                "tunnel": msg.get("tunnel"),
                "ok": ok,
                "data": result
            }
            return await websocket.send(json.dumps(reply))

    ####################################################################
    # REQUEST HANDLERS
    ####################################################################

    def handle_GET(self, websocket, msg):
        """
        returns (ok, result)
        """
        n_path = normalize(msg["path"])
        path = str(n_path)

        if n_path == PurePosixPath("/"):
            # return service listing
            result = list(self._services.keys())
            ok = result is not None
            return ok, result

        if n_path == PurePosixPath("/subs"):
            # return subscriptions of client
            return True, self._clients.get_subs(websocket)

        # service
        service_name = n_path.parts[1]
        service = self._services.get(service_name, None)
        if service is None:
            return False, "no service"
        else:
            return service.get(path)

    def handle_PUT(self, websocket, msg):
        """
        returns (ok, result)
        """
        n_path = normalize(msg["path"])
        path = str(n_path)
        args = msg["args"]

        if n_path == PurePosixPath("/subs"):
            self._clients.put_subs(websocket, args)
            # return subscriptions of client
            return True, self._clients.get_subs(websocket)

        # service
        service_name = n_path.parts[1]
        service = self._services.get(service_name, None)
        if service is None:
            return False, "no service"
        else:
            diff = service.put(path, args)
            return service.get(path)
        return False, None

    def handle_DELETE(self, websocket, msg):
        n_path = normalize(msg["path"])
        return False, None


########################################################################
# CLI
########################################################################

def main():

    import argparse
    import json

    parser = argparse.ArgumentParser(description="DataCannon Server")
    parser.add_argument('config',
                        type=str,
                        help='Path to the configuration file (JSON)')

    args = parser.parse_args()

    with open(args.config) as f:
        config = json.load(f)

    host = config["service"]["host"]
    port = int(config["service"]["port"])
    services = config["services"]    
    server = DataCannon(host=host, port=port, services=services)
    server.serve_forever()


########################################################################
# MAIN
########################################################################

if __name__ == '__main__':
    main()
