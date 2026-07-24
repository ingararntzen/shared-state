import asyncio
import json
import urllib.request
import pytest
import websockets
from sharedstate.ss_server import SharedStateServer, MsgType, MsgCmd


@pytest.fixture
async def server(tmp_path):
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
    http_log = str(tmp_path / "http.log")
    ws_log = str(tmp_path / "ws.log")

    srv = SharedStateServer(
        host="127.0.0.1",
        http_port=0,
        ws_port=0,
        http_log=http_log,
        ws_log=ws_log,
        services=services_config
    )
    for service in srv._services.values():
        await service.open()

    srv._ws_server = await websockets.serve(srv._handle_ws_client, srv._host, srv._ws_port)
    srv._http_server = await asyncio.start_server(srv._handle_http_client, srv._host, srv._http_port)

    http_port = srv._http_server.sockets[0].getsockname()[1]
    ws_port = srv._ws_server.sockets[0].getsockname()[1]
    srv._http_port = http_port
    srv._ws_port = ws_port

    yield srv, http_port, ws_port

    await srv.shutdown()


def make_ws_client(ws_port):
    return websockets.connect(f"ws://127.0.0.1:{ws_port}")


async def send_ws_request(ws, cmd, path, arg=None):
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


def _sync_http_get_json(http_port, path):
    url = f"http://127.0.0.1:{http_port}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))


async def http_get_json(http_port, path):
    return await asyncio.to_thread(_sync_http_get_json, http_port, path)


def _sync_http_get_raw(http_port, path):
    url = f"http://127.0.0.1:{http_port}{path}"
    with urllib.request.urlopen(url) as resp:
        return resp.status, resp.read().decode('utf-8')


async def http_get_raw(http_port, path):
    return await asyncio.to_thread(_sync_http_get_raw, http_port, path)


# =====================================================================
# WEBSOCKET TESTS
# =====================================================================

@pytest.mark.asyncio
async def test_ws_get_services(server):
    _, _, ws_port = server
    async with make_ws_client(ws_port) as ws:
        reply = await send_ws_request(ws, MsgCmd.GET, "/")
        assert reply["type"] == MsgType.REPLY
        assert reply["ok"] is True
        assert "mitems" in reply["data"]


@pytest.mark.asyncio
async def test_ws_get_clock(server):
    _, _, ws_port = server
    async with make_ws_client(ws_port) as ws:
        reply = await send_ws_request(ws, MsgCmd.GET, "/clock")
        assert reply["type"] == MsgType.REPLY
        assert reply["ok"] is True
        assert isinstance(reply["data"], (int, float))
        assert reply["data"] > 0


@pytest.mark.asyncio
async def test_ws_items_crud(server):
    _, _, ws_port = server
    async with make_ws_client(ws_port) as ws:
        path = "/app/mitems/chnl"
        items = [{"id": "item1", "data": "val1"}]
        reply = await send_ws_request(ws, MsgCmd.PUT, path, {"insert": items})
        assert reply["ok"] is True
        assert reply["data"] == 1

        reply = await send_ws_request(ws, MsgCmd.GET, path)
        assert reply["ok"] is True
        assert reply["data"][0]["id"] == "item1"


@pytest.mark.asyncio
async def test_ws_multicast_notify(server):
    _, _, ws_port = server
    sub_path = "/app/mitems/chnl"

    async with make_ws_client(ws_port) as ws_a, make_ws_client(ws_port) as ws_b:
        sub_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "arg": {"insert": [[sub_path, {}]], "reset": True}
        }
        await ws_a.send(json.dumps(sub_req))
        assert json.loads(await ws_a.recv())["type"] == MsgType.REPLY
        assert json.loads(await ws_a.recv())["type"] == MsgType.MESSAGE

        item = {"id": "b_item", "data": "b_data"}
        await ws_b.send(json.dumps({
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": sub_path,
            "arg": {"insert": [item]}
        }))
        await ws_b.recv()  # REPLY

        msg_a = json.loads(await ws_a.recv())
        assert msg_a["type"] == MsgType.MESSAGE
        assert msg_a["path"] == sub_path
        assert msg_a["data"]["insert"] == [item]


# =====================================================================
# HTTP REST & ADMIN ENDPOINT TESTS
# =====================================================================

@pytest.mark.asyncio
async def test_http_services_list(server):
    _, http_port, _ = server
    status, data = await http_get_json(http_port, "/services")
    assert status == 200
    srv_names = [s["name"] if isinstance(s, dict) else s for s in data["data"]]
    assert "mitems" in srv_names


@pytest.mark.asyncio
async def test_http_rest_hierarchy(server):
    _, http_port, ws_port = server
    path = "/app/mitems/chnl"

    # Insert items via WS
    async with make_ws_client(ws_port) as ws:
        await send_ws_request(ws, MsgCmd.PUT, path, {"insert": [{"id": "h1", "data": "test"}]})

    # 1. GET /services/mitems/ -> list app names
    status, res = await http_get_json(http_port, "/services/mitems/")
    assert status == 200
    assert res["ok"] is True
    assert "app" in res["data"]

    # 2. GET /services/mitems/app/ -> list channel names
    status, res = await http_get_json(http_port, "/services/mitems/app/")
    assert status == 200
    assert res["ok"] is True
    assert "chnl" in res["data"]

    # 3. GET /services/mitems/app/chnl -> list items
    status, res = await http_get_json(http_port, "/services/mitems/app/chnl")
    assert status == 200
    assert res["ok"] is True
    assert len(res["data"]) == 1
    assert res["data"][0]["id"] == "h1"


@pytest.mark.asyncio
async def test_http_subs_and_connections(server):
    _, http_port, ws_port = server

    async with make_ws_client(ws_port) as ws:
        # Subscribe
        sub_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "arg": {"insert": [["/app/mitems/chnl", {}]], "reset": True}
        }
        await ws.send(json.dumps(sub_req))
        await ws.recv()  # REPLY
        await ws.recv()  # NOTIFY

        # Query HTTP /connections
        status, conns_res = await http_get_json(http_port, "/connections")
        assert status == 200
        assert conns_res["ok"] is True
        assert len(conns_res["data"]) == 1

        # Query HTTP /subs
        status, subs_res = await http_get_json(http_port, "/subs")
        assert status == 200
        assert subs_res["ok"] is True
        assert len(subs_res["data"]) == 1
        assert subs_res["data"][0]["path"] == "/app/mitems/chnl"


@pytest.mark.asyncio
async def test_http_static_explorer_ui(server):
    _, http_port, _ = server
    status, content = await http_get_raw(http_port, "/")
    assert status == 200
    assert "<title>SharedState - Overview</title>" in content
