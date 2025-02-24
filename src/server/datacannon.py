import asyncio
import websockets
import json
import traceback
import time


def split_path(path):
    """Return (service_name, channel)."""
    tokens = path.split("/")
    chnl = tokens[-1]
    name = "/".join(tokens[:-1])
    return name, chnl

########################################################################
# Messages
########################################################################


# Message Types
class MsgType:
    """Message types used by dcserver and dcclient."""

    MESSAGE = "message"
    REQUEST = "request"
    RESPONSE = "response"


class MsgCmd:
    """Message commands used by dcserver and dcclient."""

    PING = "ping"
    PONG = "pong"

    QUERY_SERVICES = "query_services"
    QUERY_PATHS = "query_paths"

    QUERY_SUBS = "query_subs"
    UPDATE_SUBS = "update_subs"

    QUERY_SERVICE = "query_service"
    UPDATE_SERVICE = "update_service"
    CLEAR_SERVICE = "clear_service"

    RESET_START = "reset_start"
    RESET_CHANGE = "reset_change"
    RESET_END = "reset_end"
    NOTIFY_START = "notify_start"
    NOTIFY_CHANGE = "notify_change"
    NOTIFY_END = "notify_end"


########################################################################
# DataCannon
########################################################################

class DataCannon:

    def __init__(self, port=8000, host="0.0.0.0", service_map={}):
        self._host = host
        self._port = port
        self._stop_event = asyncio.Event()
        self._service_map = service_map

    async def handler(self, websocket, path):
        self.on_connect(websocket)
        try:
            async for data in websocket:
                try:
                    self.on_message(websocket, data)
                except Exception as e:
                    print("Exception", e)
                    traceback.print_exc()
        except websockets.exceptions.ConnectionClosed:
            self.on_disconnect(websocket)

    async def _start_server(self):
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
    # API
    ####################################################################

    def services(self):
        """Return names of all services supported by server."""
        return list(self._service_map.keys())

    def service_by_name(self, name):
        """Return service by name."""
        return self._service_map.get(name)

    def paths(self):
        """Return all unique paths supported by server."""
        paths = []
        for name, service in self._service_map.items():
            for chnl in service.channels():
                paths.append(f'{name}/{chnl}')
        return paths

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
            reply["type"] = MsgType.RESPONSE
            reply["tunnel"] = msg.get("tunnel")
            result = None

            if msg['cmd'] == MsgCmd.PING:
                result = (msg['data'][0], time.time())
            elif msg['cmd'] == MsgCmd.QUERY_SERVICES:
                result = self.services()
            elif msg['cmd'] == MsgCmd.QUERY_PATHS:
                result = self.paths()
            elif msg['cmd'] == MsgCmd.QUERY_SERVICE:
                result = []
                for path in msg['arg']:
                    name, chnl = split_path(path)
                    service = self.service_by_name(name)
                    if service is None:
                        continue
                    items = []
                    for batch in service.get(chnl):
                        items.extend(batch)
                    result.append((path, items))

            if result is not None:
                reply['status'] = 200
                reply['data'] = result
            else:
                reply['status'] = 404
                reply["data"] = "no result"
            await websocket.send(reply)
