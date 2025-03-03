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
            if method == "unicast_reset":
                await self._process_unicast_reset(*args)
            elif method == "multicast_reset":
                await self._process_multicast_reset(*args)
            elif method == "multicast_notify":
                await self._process_multicast_notify(*args)
        self._tasks = []

    async def _process_unicast_reset(self, websocket, paths):
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

    async def _process_multicast_reset(self, path, items):
        """
        Multicast reset notifications to clients which have
        subscribed to this resource (path)

        Reset are triggered after PUT REPLACE
        to a shared resource (path)
        """
        msg = {
            "type": MsgType.MESSAGE,
            "cmd": MsgCmd.RESET,
            "path": path,
            "data": items
        }
        data = json.dumps(msg)
        for ws in self._clients.clients(path):
            await ws.send(data)

    async def _process_multicast_notify(self, path, diffs, include_oldstate):
        """
        Multicast notifications to clients which have
        subscribed to this resource (path).

        Notifications are triggered after PUT UPDATE
        to a shared resource (path),
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
            self._tasks.append(("unicast_reset", websocket, reset_paths))
            # return subscriptions of client
            return True, self._clients.get_subs(websocket)

        # /app/service
        app, service, chnl = n_path.parts[1:4]

        srvc = self._services.get(service, None)
        if srvc is None:
            return False, "no service"

        insert = args.get("insert", [])
        remove = args.get("remove", [])
        clear = args.get("clear", False)
        if clear:
            items = srvc.replace(app, chnl, insert)
            self._tasks.append(("multicast_reset", path, items))
            return True, len(items)
        else:
            diffs = srvc.update(app, chnl, remove, insert)
            include_oldstate = getattr(srvc, "include_oldstate", False)
            self._tasks.append(("multicast_notify",
                                path, diffs, include_oldstate))
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


"""
NOTE - DESIGN - SERVER-SIDE SUBSCRIPTIONS

Subscriptions could be more advanced than just on/off
for a (client, resource) - which they currently are.

For example, assuming the resource is a collection, then
a subscription (for notifications) could be limited to only a
subset of the collection.

1) The key requirement for the notification protocol is that
clients must trust that they receiven notification of ALL
changes.

2) At the same time, it is attractive to perform notification
filtering on the server-side, so that only relevant
notifications are sent to each client.

This can be particularly usefult when many clients are only
interested in monitoring a very small portion of a large
collection, and when changes happen frequently in areas
which are not of interest.

Achieving both 1) and 2) is possible, but it also has
a downside.

Consider the relevance check to be performed by the server.
Focusing on the update of a single item in a collection,
this occurence falls into one of 4 distinct types
of relevance transformations.

Relevance transformations
- 1) irrelevant -> relevant
- 2) relevant -> relevant
- 3) relevant -> irrelevant
- 4) irrelevant -> irrelevant

In order to maintain the correct state at the client
side all occurences in group 1),2),3) must be communicated
to the client. Only group 4) can safely be dropped.

PROBLEM

The problem though, in order to distinguish between group
3) and 4) - access to the old state of the item is needed.

Furthermore, this has implications for service implementations,
as change operations become slower, if they always have to
look up current state before changing it.


ALTERNATIVE 1

One alternative is to support server-side filter subscriptions.
The service will then have to lookup old state ahead of
update change, and produce diffs in the following format,
representing the effects of the update operation. Following
this, server-side filter processing can calculate
relevance both before and after the operation, and use this
to correctly identify and drop notification belonging to group 4)

[
    {
        'id': 'id1',
        'new': {...},
        'old': None
    },
    {
        'id': 'id2',
        'new': None,
        'old': {...}
    }
]

ALTERNATIVE 2

Another alternative is to multicast all notifications
(including group 4) and leave relevance checking to the client.
Upon receipt, the client will then use local state as old state,
and be able to figure out exactly which items should be added,
changed, or removed.

If so, services would not have to include information about
old state after an update operation. Instead, they would just
include the new state of all changed items.

[
    {
        'id': 'id1',
        "new": {...}
    },
    {
        'id': 'id2',
        "new": None
    }
]


ALTERNATIVE 3

There is also a third alternative, which is to avoid diffs all
togheter, and simply reset all affected client connections after
every update. This is similar to ALTERNATIVE 2, in the sense that
is shifts relevance-filtering to the client, and introduces
inefficiency in communication. However, ALTERNATIVE 3 is significantly
worse that ALTERNATIVE 2 as it will rebroadcast all state, as
opposed to only the state that has changed.


DISCUSSION

Alternative 1 saves communiction bandwith when clients only
want to subscribe to a small subset of a collection, while
updates are applied across the collection. On the down side,
update latency is higher.

Alternative 2 implies some inefficiency as group 4) notifications
will be unessesarily multicast to all clients always.
On the other hand, it makes for an efficient solution on the
server side, ensuring that change operations may be completed by
a single database operation, and that relevance-filtering,
which is essentially a client-specific operation, is performed
by clients instead of the server - in reference to local state.

DECISION

The choice is to implement ALTERNATIVE 2 as default solution,
but to make sure the design is open to future support for
ALTERNATIVE 1 as well.

We do this by
- Defining a diff format (above) which suits both alternatives
- Let services signal the supported mode
  service.include_oldstate {True|False}
- Sub args - can be extended with filter state
- Implementation of server-side filtering can then be added later if needed,
as part of reset and nofitication processing.
- Clients do not need to know about this distinction, as long
  as they can filter out group 4) notifications.
- When service.replace is used instead of service.update
  diffs are avoided, so this is not relevant in that case.
"""
