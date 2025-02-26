import asyncio
import websockets
import json
import traceback
from urllib.parse import urlparse
# from urllib.parse import parse_qs
from pathlib import Path, PurePosixPath
import importlib


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
# Util
########################################################################

def path_from_module(mod):
    path = Path(mod.__file__)
    return path.relative_to(path.parent.parent)


########################################################################
# Service Directory
########################################################################

def normalize(path):
    path = PurePosixPath(path)
    return path if path.is_absolute() else PurePosixPath(f"/{path}")


class Directory:

    def __init__(self):
        self.map = {}

    def add(self, path, module):
        n_path = normalize(path)
        self.map[n_path] = module

    def get(self, path="/"):
        n_path = normalize(path)
        if path.endswith("/"):
            # list contents at level -- all paths with n_path == commonpath
            def keep(p):
                try:
                    p.relative_to(n_path)
                except ValueError:
                    return False
                return True
            return sorted([str(p) for p in self.map.keys() if keep(p)])
        else:
            # return module
            return self.map.get(n_path, None)


########################################################################
# DataCannon
########################################################################

class DataCannon:

    def __init__(self, port=8000, host="0.0.0.0", services={}):
        self._host = host
        self._port = port

        # internal services
        self._directory = Directory()
        self._directory.add("/subs", None)
        # load services
        for alias, service in services.items():
            mod = importlib.import_module(f"src.server.services.{service}")
            self._directory.add(alias, mod.get_service())

        print("DataCannon: Services:")
        print(self._directory.get("/"))

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
        print(websocket.remote_address, 'connected')

    def on_disconnect(self, websocket):
        """Handle client diconnect."""
        print(websocket.remote_address, 'disconnected')

    async def on_message(self, websocket, data):
        """Handle message from client."""
        msg = json.loads(data)
        if msg['type'] == MsgType.REQUEST:

            # handle request
            reply = {}
            reply["type"] = MsgType.REPLY
            reply["cmd"] = msg["cmd"]
            reply["tunnel"] = msg.get("tunnel")

            # parse path
            parsed = urlparse(msg["path"])
            path = parsed.path

            status, result = True, None
            if msg['cmd'] == MsgCmd.GET:

                if path.endswith("/"):
                    # return listing
                    result = self._directory.get(path)
                else:
                    # resolve value from service
                    service = self._directory.get(path)
                    if service is not None:
                        status, result = service.get(path)
                    else:
                        status, result = False, "no service"

                reply["status"] = status
                reply["data"] = result

                print("reply", reply)
                await websocket.send(json.dumps(reply))


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
