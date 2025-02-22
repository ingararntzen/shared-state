"""DataCannon server implementation."""

from SimpleWebSocketServer import SimpleWebSocketServer, WebSocket
import json
from src.server.filters import evaluate
import src.server.intervals as intervals

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

    QUERY_SERVICES = "query_services"
    QUERY_PATHS = "query_paths"
    QUERY_SUBS = "query_subs"
    QUERY_ITEMS = "query_items"
    UPDATE_SUBS = "update_subs"
    UPDATE_ITEMS = "update_items"
    CLEAR_ITEMS = "clear_items"
    RESET_START = "reset_start"
    RESET_CHANGE = "reset_change"
    RESET_END = "reset_end"
    NOTIFY_START = "notify_start"
    NOTIFY_CHANGE = "notify_change"
    NOTIFY_END = "notify_end"


def split_path(path):
    """Return (service_name, channel)."""
    tokens = path.split("/")
    chnl = tokens[-1]
    name = "/".join(tokens[:-1])
    return name, chnl


def join_path(name, chnl):
    """Return path from service name and channel."""
    return f'{name}/{chnl}'


def intersects(a, b):
    """Return true if two intervals intersect."""
    NO_INTERSECT = [
        intervals.IntervalRelation.OUTSIDE_LEFT,
        intervals.IntervalRelation.OUTSIDE_RIGHT
    ]
    res = intervals.compare(a, b)
    return res not in NO_INTERSECT


########################################################################
# WebSocket IO Object
########################################################################

class IO (WebSocket):
    """IO object implemented over WebSocket."""

    def send(self, msg):
        """Send message on io object."""
        data = json.dumps(msg)
        self.sendMessage(data)

    def handleMessage(self):
        """Receive message from io object."""
        try:
            msg = json.loads(self.data)
            self.server._handleMessage(self, msg)
        except Exception as e:
            print("Exception", e)
            import traceback
            traceback.print_exc()

    def handleConnected(self):
        """IO object is connected."""
        self.server._handleConnect(self)

    def handleClose(self):
        """IO object is disconnected."""
        self.server._handleDisconnect(self)


########################################################################
# CLIENTS
########################################################################

class Clients:
    """Server-side client state."""

    def __init__(self):
        """Create internal dict."""
        # io -> subs_map: {path -> sfilter}
        self._dict = {}

    def register(self, io):
        """Register client."""
        if io not in self._dict:
            self._dict[io] = {}

    def unregister(self, io):
        """Unregister client."""
        if io in self._dict:
            del self._dict[io]

    def clients(self, path):
        """Return list of io objects for clients registered to path."""
        res = []
        for io, subs_map in self._dict.items():
            if path in subs_map:
                res.append(io)
        return res

    def is_subscribed(self, io, path):
        """Return true is client has a subscription on path."""
        return path in self._dict[io]

    def update(self, io, subOps):
        """
        Set subscriptions for io.

        Process subOps
        Return ["reset", paths]

        [SUB]
        sub changes the subscription for one client.
        there are two approaches for dealing with this

        Approach 1.
            always RESET the path for the client
        Approach 2.
            figure out the nature of the change, and
            choose the appropriate method - RESET and DIFF
            - if the filter was changed - RESET
            - if range intervals were changed - DIFF

        Approach 2 is more complicated. The benefit would
        be that given multiple range intevals, one could be moved
        without having to RESET all of them.

        Implementation of 2 would have to calculate which
        segments on the timeline
        - enter intervals: not subscribe -> subscribe
        - keep intervals:  subscribe -> subscribe
        - exit intervals: subscribe -> not subscribe

        This requires range intervals to be normalized
        old_itvs = intervals.normalise(old_itvs)
        new_itvs = intervals.normalise(new_itvs)

        enter_itvs = intervals.set_difference(new_itvs, old_itvs)
        keep_itvs = intervals.set_intersection(old_itvs, new_itvs)
        exit_itvs = intervals.set_difference(old_itvs, new_itvs)

        - [keep and exit] ranges can be sent directly to the client
          which may then drop any interval which intersects [exit],
          unless it also intersects [keep]
        - [enter] ranges: items must be looked up from the db and
          sent to the client.

        return {path : op}

        where op
        {"type": "reset"}
        {"type": "diff", "enter": [...], "keep": [...], "exit": [...]}

        For now, approach 1 is implemented

        """
        if io not in self._dict:
            print("should never happen: io not registered", subOps)
            return
        subs_map = self._dict[io]
        res = {}
        for subOp in subOps:
            _type = subOp["type"]
            _path = subOp["path"]
            if _type == "sub":
                subs_map.setdefault(_path, {})
                # filter
                if "sfilter" in subOp["arg"]:
                    if subOp["arg"]["sfilter"] is None:
                        # delete sfilter
                        if "sfilter" in subs_map[_path]:
                            del subs_map[_path]["sfilter"]
                    else:
                        # replace sfilter
                        subs_map[_path]["sfilter"] = subOp["arg"]["sfilter"]
                # ranges
                if "sranges" in subOp["arg"]:
                    if subOp["arg"]["sranges"] is None:
                        # delete ranges
                        if "sranges" in subs_map[_path]:
                            del subs_map[_path]["sranges"]
                    else:
                        # replace ranges
                        new_ranges = subOp["arg"]["sranges"]
                        new_ranges = intervals.normalise(new_ranges)
                        subs_map[_path]["sranges"] = new_ranges
                # reset
                res[_path] = {"type": "reset"}
            elif _type == "unsub":
                del subs_map[_path]
            elif _type == "reset":
                res[_path] = {"type": "reset"}

        return res

    def get_subs(self, io, path=None):
        """Return subscriptions of one client as list."""
        if path is None:
            return list(self._dict[io].items())
        else:
            return self._dict[io][path]


########################################################################
# SERVER
########################################################################

class Server (SimpleWebSocketServer):
    """DataCannon Server."""

    def __init__(self, host, port, config, selectInterval=0.1):
        """Create server."""
        super().__init__(host, port, IO,
                         selectInterval=selectInterval)

        # services
        self._services = {}
        for name, service in config.get("services", []):
            self._services[name] = service

        # clients
        self._clients = Clients()

        # tasks
        self._tasks = []

    ####################################################################
    # API
    ####################################################################

    def services(self):
        """Return names of all services supported by server."""
        return list(self._services.keys())

    def service_by_name(self, name):
        """Return service by name."""
        return self._services.get(name)

    def check_filter(self, path, filter):
        """Check if a given filter is valid for service."""
        # TODO
        return True

    def paths(self):
        """Return all unique paths supported by server."""
        paths = []
        for name, service in self._services.items():
            for chnl in service.channels():
                paths.append(join_path(name, chnl))
        return paths

    ####################################################################
    # HANDLERS
    ####################################################################

    def _handleConnect(self, io):
        """Handle client connect."""
        self._clients.register(io)
        print(io.address, 'connected')

    def _handleDisconnect(self, io):
        """Handle client diconnect."""
        self._clients.unregister(io)
        print(io.address, 'closed')

    def _handleMessage(self, io, msg):
        """Handle message from client."""
        _type = msg.get("type")

        if _type == MsgType.REQUEST:
            # handle request
            reply = {}
            reply["type"] = MsgType.RESPONSE
            reply["tunnel"] = msg.get("tunnel")
            result = self._handleRequest(io, msg, reply)
            if result is not None:
                reply["status"], reply["data"] = result
                io.send(reply)

        # Processing requests may produce tasks
        self._handleTasks()

    def _handleTasks(self):
        """Process tasks if any."""
        for task in self._tasks:
            method, *args = task
            if method == "reset":
                self._taskReset(*args)
            elif method == "update":
                self._taskUpdate(*args)
        self._tasks = []

    def _handleRequest(self, io, req, reply):
        """Handle request from client."""
        _cmd = req.get("cmd")
        _argList = req.get("arg")
        # QUERY
        if _cmd == MsgCmd.QUERY_SERVICES:
            return 200, self.services()
        elif _cmd == MsgCmd.QUERY_PATHS:
            return 200, self.paths()
        elif _cmd == MsgCmd.QUERY_SUBS:
            return 200, self._clients.get_subs(io)
        elif _cmd == MsgCmd.QUERY_ITEMS:
            result = []
            for path in _argList:
                items = []
                name, chnl = split_path(path)
                service = self.service_by_name(name)
                if service is None:
                    return 404, "no service", service
                for batch in service.get(chnl):
                    items.extend(batch)
                result.append((path, items))
            return 200, result

        # UPDATE
        if _cmd == MsgCmd.UPDATE_SUBS:
            res = self._clients.update(io, _argList)
            # reset paths
            reset_paths = [p for p, d in res.items() if d["type"] == "reset"]
            # no support for diffs
            result = self._clients.get_subs(io)
            # reset connection for relevant paths
            self._tasks.append(("reset", io, reset_paths))
            return 200, result

        elif _cmd == MsgCmd.UPDATE_ITEMS:
            self._tasks.append(("update", io, req, reply))
            # reply to be sent just ahead of notificiations.
            return

        elif _cmd == MsgCmd.CLEAR_ITEMS:
            state_dict = {}
            for path in req.get("arg", []):
                name, chnl = split_path(path)
                service = self.service_by_name(name)
                state_dict[path] = service.clear(chnl)
            self._process_notifications(state_dict, req.get("tunnel"))
            result = [[path, len(items)] for path, items in state_dict.items()]
            return 200, result

    ####################################################################
    # TASKS
    ####################################################################

    def _taskReset(self, io, paths):
        """
        Asynchronously reading items from service paths.

        For the purpose of resetting given connection
        """
        # reset all paths
        for path in paths:
            # start reset
            io.send(dict(
                type=MsgType.MESSAGE,
                cmd=MsgCmd.RESET_START,
                path=path))

            name, chnl = split_path(path)
            service = self.service_by_name(name)
            if service is None:
                print("service not supported", name)
                # TODO : should have checked service name when
                # receiving the request, and then generated 
                # a fitting error reply to the client 
                continue
            if self._clients.is_subscribed(io, path):

                # prepare filtering
                subArg = self._clients.get_subs(io, path)
                sfilter = subArg.get("sfilter")

                def send_batch(batch):
                    # filter
                    if sfilter is not None:
                        batch = [i for i in batch if evaluate(i, sfilter)]
                    # send
                    io.send(dict(
                        type=MsgType.MESSAGE,
                        cmd=MsgCmd.RESET_CHANGE,
                        path=path,
                        data=batch))

                # prepare intervals
                sranges = subArg.get("sranges", [])
                if sranges and service.lookup_supported():
                    for rng in sranges:
                        # multiple lookups may generate duplicates
                        # handled by clients
                        for batch in service.lookup(chnl, rng):
                            send_batch(batch)
                else:
                    for batch in service.get(chnl):

                        send_batch(batch)

            # end reset
            io.send(dict(
                type=MsgType.MESSAGE,
                cmd=MsgCmd.RESET_END,
                path=path))

    def _taskUpdate(self, io, req, reply):
        """
        Process update request.

        If update request is absolute, request reply and notifications may be
        sent before the requests is processed by the DB service.
        This minimizes update latency.

        In contrast, if the update request is relative (i.e. the result is not
        known until after DB processing), the DB processing must be performed
        first so that results can be used for notifications.

        All updates must be absolute, for the operation as a whole to be
        absolute.

        State representation

        Initially, <state-dict> represents intention to insert, replace or
        delete items.

        After DB processing, <state-dict> represents reality, i.e.
        which items were actually inserted, replaced or deleted.

        However, in both cases, the <state-dict> is structured the same way.
        """
        # <state-dict>  path:[items]
        state_dict = dict(req.get("arg"))

        # figure out if all operations are absolute
        absolutes = []
        for path in set(state_dict.keys()):
            name, chnl = split_path(path)
            service = self.service_by_name(name)
            absolutes.append(service.update_is_absolute())
        absolute = all(absolutes)
        if not absolute:
            # process update request before notifications
            state_dict = self._process_update(state_dict)

        # update request response
        result = [[path, len(items)] for path, items in state_dict.items()]
        reply["status"], reply["data"] = 200, result
        io.send(reply)

        self._process_notifications(state_dict, req.get("tunnel"))

        if absolute:
            # process update request after notifications
            state_dict = self._process_update(state_dict)

    ####################################################################
    # INTERNAL
    ####################################################################

    def _process_update(self, state_dict):
        """
        Update services. Intended state changes given by state_dict.

        Returns state dict representing the actual state changes.

        The intented state dict and the actual state dict
        may not necessarily be identical.
        """
        for path, items in state_dict.copy().items():
            name, chnl = split_path(path)
            service = self.service_by_name(name)
            state_dict[path] = service.update(chnl, items)
        return state_dict

    def _process_notifications(self, state_dict, tunnel):
        """Multicast notifications of state changes to relevant clients."""
        io_set = set()
        for path, items in state_dict.items():
            # relevant clients for path
            ios = self._clients.clients(path)
            for io in ios:
                if (io, path) not in io_set:
                    io_set.add((io, path))
                    io.send(dict(
                        type=MsgType.MESSAGE,
                        cmd=MsgCmd.NOTIFY_START,
                        path=path,
                        tunnel=tunnel))

                # intervals & filter
                subArg = self._clients.get_subs(io, path)
                sfilter = subArg.get("sfilter")
                name, chnl = split_path(path)
                service = self.service_by_name(name)
                if service.lookup_supported():
                    sranges = None
                else:
                    sranges = subArg.get("sranges", [])

                if sfilter or sranges:
                    def f(item):
                        # intervals
                        if sranges:
                            # check that item intersects with at least 1 range
                            match = False
                            for rng in sranges:
                                if intersects(rng, item["itv"]):
                                    match = True
                                    break
                            if not match:
                                return False
                        # filter
                        if sfilter:
                            if not evaluate(item, sfilter):
                                return False
                        return True

                    items = [i for i in items if f(i)]

                io.send(dict(
                    type=MsgType.MESSAGE,
                    cmd=MsgCmd.NOTIFY_CHANGE,
                    path=path,
                    tunnel=tunnel,
                    data=items))

        for io, path in io_set:
            io.send(dict(
                type=MsgType.MESSAGE,
                cmd=MsgCmd.NOTIFY_END,
                path=path,
                tunnel=tunnel))


########################################################################
# MAIN
########################################################################

def main():

    from src.server import db_items
    from src.server import db_points
    from src.server import db_intervals
    from src.server import db_disjoint_intervals

    cfg = {
        "port": 8000,
        "services": [
            ("items", db_items.getDB()),
            ("samples", db_points.getDB()),
            ("cues", db_intervals.getDB()),
            ("segments", db_disjoint_intervals.getDB()),
            ("vars", db_items.getDB("vars")),
            ("tracks", db_disjoint_intervals.getDB("tracks"))
        ]
    }

    PORT = 8000
    server = Server('', cfg["port"], cfg)
    print(f'ws://localhost:{cfg["port"]}')
    try:
        server.serveforever()
    except KeyboardInterrupt:
        print("")
        pass
    print("done")


if __name__ == '__main__':
    main()