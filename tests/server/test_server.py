import asyncio
import json
import pytest
import websockets
from sharedstate.ss_server import SharedStateServer, MsgType, MsgCmd


@pytest.fixture
async def server():
    services_config = [
        {
            "name": "mitems",
            "module": "items_service",
            "config": {
                "db_type": "sqlite",
                "db_name": ":memory:",
                "db_table": "items"
            }
        }
    ]
    srv = SharedStateServer(host="127.0.0.1", port=0, services=services_config)
    for service in srv._services.values():
        await service.open()
    ws_server = await websockets.serve(srv.handler, srv._host, srv._port)
    srv._server = ws_server
    port = ws_server.sockets[0].getsockname()[1]

    yield srv, port

    await srv.shutdown()


def make_client(port):
    return websockets.connect(f"ws://127.0.0.1:{port}")


async def send_request(ws, cmd, path, arg=None):
    req = {
        "type": MsgType.REQUEST,
        "cmd": cmd,
        "path": path,
    }
    if arg is not None:
        req["arg"] = arg
    await ws.send(json.dumps(req))
    resp = await ws.recv()
    return json.loads(resp)


@pytest.mark.asyncio
async def test_get_services(server):
    _, port = server
    async with make_client(port) as ws:
        reply = await send_request(ws, MsgCmd.GET, "/")
        assert reply["type"] == MsgType.REPLY
        assert reply["cmd"] == MsgCmd.GET
        assert reply["ok"] is True
        assert "mitems" in reply["data"]


@pytest.mark.asyncio
async def test_get_clock(server):
    _, port = server
    async with make_client(port) as ws:
        reply = await send_request(ws, MsgCmd.GET, "/clock")
        assert reply["type"] == MsgType.REPLY
        assert reply["ok"] is True
        assert isinstance(reply["data"], (int, float))
        assert reply["data"] > 0


@pytest.mark.asyncio
async def test_invalid_service(server):
    _, port = server
    async with make_client(port) as ws:
        reply = await send_request(ws, MsgCmd.GET, "/app/unknown_service/chnl")
        assert reply["type"] == MsgType.REPLY
        assert reply["ok"] is False
        assert reply["data"] == "no service"


@pytest.mark.asyncio
async def test_subs(server):
    _, port = server
    async with make_client(port) as ws:
        # GET empty subs
        reply = await send_request(ws, MsgCmd.GET, "/subs")
        assert reply["ok"] is True
        assert reply["data"] == []

        # PUT subs triggers a reply AND a unicast NOTIFY message
        sub_path = "/app/mitems/chnl"
        req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "arg": {"insert": [[sub_path, {}]], "reset": True}
        }
        await ws.send(json.dumps(req))

        # Receive REPLY first
        reply_data = await ws.recv()
        reply = json.loads(reply_data)
        assert reply["ok"] is True
        assert len(reply["data"]) == 1
        assert reply["data"][0][0] == sub_path

        # Receive unicast NOTIFY next
        notify_data = await ws.recv()
        notify = json.loads(notify_data)
        assert notify["type"] == MsgType.MESSAGE
        assert notify["cmd"] == MsgCmd.NOTIFY
        assert notify["path"] == sub_path
        assert notify["data"] == {"remove": [], "insert": [], "reset": True}


@pytest.mark.asyncio
async def test_items_crud(server):
    _, port = server
    async with make_client(port) as ws:
        path = "/app/mitems/chnl"

        # 1. Insert items
        items = [
            {"id": "item1", "data": "val1"},
            {"id": "item2", "data": "val2"}
        ]
        reply = await send_request(ws, MsgCmd.PUT, path, {"insert": items})
        assert reply["ok"] is True
        assert reply["data"] == 2

        # 2. Get items
        reply = await send_request(ws, MsgCmd.GET, path)
        assert reply["ok"] is True
        fetched_items = reply["data"]
        assert len(fetched_items) == 2
        ids = {item["id"] for item in fetched_items}
        assert ids == {"item1", "item2"}

        # 3. Remove an item
        reply = await send_request(ws, MsgCmd.PUT, path, {"remove": ["item1"]})
        assert reply["ok"] is True
        assert reply["data"] == 1

        reply = await send_request(ws, MsgCmd.GET, path)
        assert len(reply["data"]) == 1
        assert reply["data"][0]["id"] == "item2"

        # 4. Reset collection
        new_items = [{"id": "item3", "data": "val3"}]
        reply = await send_request(ws, MsgCmd.PUT, path, {"insert": new_items, "reset": True})
        assert reply["ok"] is True

        reply = await send_request(ws, MsgCmd.GET, path)
        assert len(reply["data"]) == 1
        assert reply["data"][0]["id"] == "item3"


@pytest.mark.asyncio
async def test_multicast_notify(server):
    _, port = server
    sub_path = "/app/mitems/chnl"

    async with make_client(port) as ws_a, make_client(port) as ws_b:
        sub_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "arg": {"insert": [[sub_path, {}]], "reset": True}
        }

        # Subscribe Client A
        await ws_a.send(json.dumps(sub_req))
        assert json.loads(await ws_a.recv())["type"] == MsgType.REPLY
        assert json.loads(await ws_a.recv())["type"] == MsgType.MESSAGE  # Unicast reset

        # Subscribe Client B
        await ws_b.send(json.dumps(sub_req))
        assert json.loads(await ws_b.recv())["type"] == MsgType.REPLY
        assert json.loads(await ws_b.recv())["type"] == MsgType.MESSAGE  # Unicast reset

        # Client B inserts an item into sub_path
        item = {"id": "b_item", "data": "b_data"}
        put_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": sub_path,
            "arg": {"insert": [item]}
        }
        await ws_b.send(json.dumps(put_req))

        # Client B receives REPLY first, then multicast NOTIFY
        reply_b = json.loads(await ws_b.recv())
        assert reply_b["type"] == MsgType.REPLY
        assert reply_b["ok"] is True

        notify_b = json.loads(await ws_b.recv())
        assert notify_b["type"] == MsgType.MESSAGE
        assert notify_b["cmd"] == MsgCmd.NOTIFY
        assert notify_b["path"] == sub_path
        assert notify_b["data"]["insert"] == [item]

        # Client A also receives multicast NOTIFY
        notify_a = json.loads(await ws_a.recv())
        assert notify_a["type"] == MsgType.MESSAGE
        assert notify_a["cmd"] == MsgCmd.NOTIFY
        assert notify_a["path"] == sub_path
        assert notify_a["data"]["insert"] == [item]

        # Client A unsubscribes
        unsub_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "arg": {"insert": [], "reset": True}
        }
        await ws_a.send(json.dumps(unsub_req))
        await ws_a.recv()  # REPLY

        # Client B inserts another item
        item2 = {"id": "b_item2", "data": "b_data2"}
        await ws_b.send(json.dumps({
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": sub_path,
            "arg": {"insert": [item2]}
        }))
        await ws_b.recv()  # Client B REPLY
        notify_b2 = json.loads(await ws_b.recv())  # Client B NOTIFY
        assert notify_b2["data"]["insert"] == [item2]

        # Client A should NOT receive any notification
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(ws_a.recv(), timeout=0.2)
