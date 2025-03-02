import asyncio
import websockets
import json
import traceback
import importlib
import time
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
    RESET = "RESET"
    NOTIFY = "NOTIFY"


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

    def is_subscribed_to_path(self, websocket, path):
        """
        Return true if websocket is subscribed to path.
        """
        return self._map.get(websocket, None) is not None


########################################################################
# DataCannon
########################################################################

class DataCannon:

    def __init__(self, port=8000, host="0.0.0.0", services=[]):
        self._host = host
        self._port = port

        # client subscriptions
        self._clients = Clients()

        # processing tasks
        self._tasks = []

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
                ok, result = self.handle_GET(
                    websocket,
                    msg["path"])
            elif msg["cmd"] == MsgCmd.PUT:
                ok, result = self.handle_PUT(
                    websocket,
                    msg["path"],
                    msg["args"])

            reply = {
                "type": MsgType.REPLY,
                "cmd": msg["cmd"],
                "tunnel": msg.get("tunnel"),
                "ok": ok,
                "data": result
            }
            await websocket.send(json.dumps(reply))

            # process any tasks generated by client requests
            return await self._process_tasks()

    ####################################################################
    # TASK PROCESSING
    ####################################################################

    async def _process_tasks(self):
        """Process tasks if any."""
        for task in self._tasks:
            method, *args = task
            if method == "reset":
                await self._process_reset_task(*args)
            elif method == "notify":
                await self._process_notify_task(*args)
        self._tasks = []

    async def _process_reset_task(self, websocket, paths):
        """
        Reset a client connection, with respect to a list of paths.

        A connections is reset following a change in subscriptions.

        For a given path, there are three types of subscription changes
        - (sub) no sub -> sub
        - (reset) sub -> sub
        - (unsub) sub -> no sub

        (reset) is only possible if subscriptions are more advanced
        than just boolean - e.g. including filters etc.

        The distinction between (sub, reset, unsub) is not important,
        though, as the connection will be reset in either case,
        by sending the correct state, with [] being the correct state
        for unsub.
        """
        for path in paths:
            data = []
            if self._clients.is_subscribed_to_path(websocket, path):
                # get state
                ok, result = self.handle_GET(websocket, path)
                if ok:
                    data = result
            msg = {
                "type": MsgType.MESSAGE,
                "cmd": MsgCmd.RESET,
                "path": path,
                "data": data
            }
            await websocket.send(json.dumps(msg))

    async def _process_notify_task(self, path, diffs):
        """
        Multicast notifications to clients which have
        subscribed to this resource (path).

        Notifications are triggered after changes (diffs)
        to a shared resource (path),

        NOTE - NOTIFICATION DESIGN

        Subscriptions could be more advanced than just on/off
        for a (client, resource). For example, assuming the
        resource is a collection, a subscription could apply
        to a subset of the collection.

        If so, diffs should be checked for relevance for each
        client, and only relevant diffs should be sent.

        Relevance
        - (enter) irrelevant -> relevant
        - (change) relevant -> relevant
        - (leave) relevant -> irrelevant
        - (noop) irrelevant -> irrelevant

        In order to maintain the correct state at the client
        side all events (enter,change,leave) need to be sent,
        only (noops) can safely be dropped.

        However, distinguishing between (noop, leave) requires
        access to the old state of the resource - before the change.

        The diffs, though, do not provide this - they only
        indicate the state after change - with empty 'data' property
        indicating that the item was removed.

        [{'id': 'id1', 'data': 'data1'}, {'id': 'id2'}]

        There is a good reason for this. Providing the
        old state as part of the diffs would have implications
        for the efficiency of the PUT operation, as it would
        effectively require a GET before every PUT operation.

        This leaves two alternatives.

        ALTERNATIVE 1

        Introduce a GET before PUT - and bring old state
        into the diffs, and implement relevance checking at the server.

        [
            {
                'new': {'id': 'id1': 'data': 'data1'},
                'old': None
            },
            {
                'new': None,
                'old': {'id': 'id2': 'data': 'data2'}
            },
        ]

        ALTERNATIVE 2

        Send all notifications (including noop) and leave
        relevance checking to the client. Upon receipt,
        the client will use local state as old state, and
        be able to figure out exactly which items should
        be added, changed, or removed.

        ALTERNATIVE 3

        Avoid diffs all togheter, and simply reset all
        affected client connections after an update.
        This is similar to ALTERNATIVE 2, in the sense that
        is shifts relevance-filtering to the client, and introduces
        inefficiency in communication. This though, is worse
        that ALTERNATIVE 2 as it will rebroadcast all state, as
        opposed to only the state that has changed.

        DISCUSSION

        Alternative 2 implies some inefficiency as (noop) messages
        will be unessesarily multicast to all clients always.
        The negative effects might be significant if update operations
        occur frequently, and many clients subscribe only to a tiny
        subset of the channel. 

        On the other hand, it makes for an efficient solution on the
        server side, ensuring that PUT operations may be completed by
        a single database operation, and that relevance-filtering,
        which is essentially a client-specific operation, is performed
        by clients instead of the server - in reference to local state.

        CONCLUSION
        - Even if subscripts are extended to include filters,
        the server implementation will not do relevance checking.
        - This is a strong argument for doing filtering on the
        client side.
        - There might be an argument for supporting server-side range
        filter for timelined data
        - It might also be possible to have a designated service
        supporting diffs with old state and range filters

        """
        msg = {
            "type": MsgType.MESSAGE,
            "cmd": MsgCmd.NOTIFY,
            "path": path,
            "data": diffs
        }
        data = json.dumps(msg)
        for ws in self._clients.clients(path):
            await ws.send(data)

    ####################################################################
    # REQUEST HANDLERS
    ####################################################################

    def handle_GET(self, websocket, path):
        """
        returns (ok, result)
        """
        n_path = normalize(path)

        if n_path == PurePosixPath("/"):
            # return service listing
            return True, list(self._services.keys())

        if n_path == PurePosixPath("/subs"):
            # return subscriptions of client
            return True, self._clients.get_subs(websocket)

        if n_path == PurePosixPath("/clock"):
            return True, time.time()

        # /app/service
        app, service, resource = n_path.parts[1:4]

        # service
        srvc = self._services.get(service, None)
        if srvc is None:
            return False, "no service"
        else:
            return True, srvc.get(app, resource)

    def handle_PUT(self, websocket, path, args):
        """
        returns (ok, result)
        """
        n_path = normalize(path)

        if n_path == PurePosixPath("/subs"):
            subs = args
            self._clients.put_subs(websocket, subs)
            reset_paths = [path for path, sub in subs]
            self._tasks.append(("reset", websocket, reset_paths))
            # return subscriptions of client
            return True, self._clients.get_subs(websocket)

        # /app/service
        app, service, resource = n_path.parts[1:4]

        srvc = self._services.get(service, None)
        if srvc is None:
            return False, "no service"

        diffs = srvc.put(app, resource, args)

        # notify changes
        self._tasks.append(("notify", path, diffs))

        return True, len(diffs)


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
