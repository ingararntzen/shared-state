import asyncio
import websockets
import json
import traceback
import time


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
# DataCannon
########################################################################

class DataCannon:

    def __init__(self, port=8000, host="0.0.0.0", service_map={}):
        self._host = host
        self._port = port
        self._service_map = service_map

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
        print("DataCannon: Services:")
        for k, v in self._service_map.items():
            print(f"-> {k} -- {v}")
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
        print("got message")
        print(msg)

        if msg['type'] == MsgType.REQUEST:

            # handle request
            reply = {}
            reply["type"] = MsgType.REPLY
            reply["cmd"] = msg["cmd"]
            reply["tunnel"] = msg.get("tunnel")
            result = None

            if msg['cmd'] == MsgCmd.GET:
                path = msg["path"]

                if path == "/services":
                    result = list(self._service_map.keys())
                elif path == "/clock":
                    result = time.time()

            if result is not None:
                reply['status'] = 200
                reply['data'] = result
            else:
                reply['status'] = 404
                reply["data"] = "no result"
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
    service_map = dict(config.items("DataCannon.Services"))
    server = DataCannon(host=host, port=port, service_map=service_map)
    server.serve_forever()


########################################################################
# MAIN
########################################################################

if __name__ == '__main__':
    main()
