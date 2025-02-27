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
    UPDATE = "UPDATE"
    CLEAR = "CLEAR"


########################################################################
# CLIENTS
########################################################################

class Clients:

    def __init__(self):
        # websocket -> {path -> subscription}
        self._map = {}

    def register(self, websocket):
        """Register client."""
        if websocket not in self._map:
            self._map[websocket] = {}

    def unregister(self, websocket):
        """Unregister client."""
        if websocket in self._map:
            del self._map[websocket]

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

    def get_subs(self, websocket):
        """
        Get all subscriptions of client
        Return [(path, sub), ...]
        """
        return list(self._map.get(websocket, {}).items())

    def get_sub_by_path(self, websocket, path):
        """
        Get subscription of client for given path
        Returns None if no subscription
        """
        return self._map.get(websocket, {}).get(path, None)        

    def is_subscribed(self, websocket, path):
        """
        Convenience method
        Return true if websocket is subscribed to path.
        """
        return self.get_sub_by_path(websocket, path) is not None

    def update_subs(self, websocket, subOps):
        """
        Process a batch of subOps for websocket.

        subOps is a list of operations

        subOp = {
            type: "sub"|"unsub"|"reset",
            path: "/service/appid/resourceid" - identify resource within service
            arg: {sfilter:, srange: [a,b]} - can be empty no filter or range
        }

        - "reset" appearantly does not do anything - except force a reset of the
        client connection

        return list of paths that need to be reset for client

        """
        subs_map = self._map[websocket]
        reset_paths = []
        for subOp in subOps:
            path = subOp["path"]
            arg = subOp.get("arg", {})
            if subOp["type"] == "sub":
                subs_map[path] = arg
            elif subOp["type"] == "unsub":
                if path in subs_map:
                    del subs_map[path]
            reset_paths.append(path)
        return reset_paths


########################################################################
# DataCannon
########################################################################

class DataCannon:

    def __init__(self, port=8000, host="0.0.0.0", services={}):
        self._host = host
        self._port = port

        # client subscriptions
        self._clients = Clients()

        # services
        self._services = {}
        # load services
        for service_name, service_module_name in services.items():
            module_path = f"src.server.services.{service_module_name}"
            service_module = importlib.import_module(module_path)
            self._services[service_name] = service_module.get_service()

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
        if msg['type'] != MsgType.REQUEST:
            return

        n_path = normalize(msg["path"])

        reply = {}
        reply["type"] = MsgType.REPLY
        reply["cmd"] = msg["cmd"]
        reply["tunnel"] = msg.get("tunnel")

        if msg['cmd'] == MsgCmd.GET:

            if n_path == PurePosixPath("/"):
                # return service listing
                reply["data"] = list(self._services.keys())
                reply["status"] = reply["data"] is not None
                return await websocket.send(json.dumps(reply))

            if n_path == PurePosixPath("/subs"):
                # return subscriptions of client
                reply["data"] = self._clients.get_subs(websocket)
                reply["status"] = True
                return await websocket.send(json.dumps(reply))

            # service
            service_name = n_path.parts[1]
            service = self._services.get(service_name, None)
            if service is None:
                reply["data"] = "no service"
                reply["status"] = False
                return await websocket.send(json.dumps(reply))
            else:
                status, data = service.get(n_path)
                reply['status'] = status
                reply['data'] = data
                return await websocket.send(json.dumps(reply))

        elif msg["cmd"] == MsgCmd.UPDATE:

            if n_path == PurePosixPath("/subs"):
                subOps = msg["args"]
                reset_paths = self._clients.update_subs(websocket, subOps)
                # return subscriptions of client
                reply["data"] = self._clients.get_subs(websocket)
                reply["status"] = True
                return await websocket.send(json.dumps(reply))


########################################################################
# CLI
########################################################################

def main():

    import argparse
    import configparser

    parser = argparse.ArgumentParser(description="DataCannon Server")
    parser.add_argument('config',
                        type=str,
                        help='Path to the configuration file')

    args = parser.parse_args()

    config = configparser.ConfigParser()
    config.read(args.config)

    host = config.get('DataCannon', 'host')
    port = config.getint('DataCannon', 'port')
    services = dict(config.items("DataCannon.Services"))
    server = DataCannon(host=host, port=port, services=services)
    server.serve_forever()


########################################################################
# MAIN
########################################################################

if __name__ == '__main__':
    main()
