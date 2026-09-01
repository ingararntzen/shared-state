import asyncio
import json
import urllib.request
import pytest
import websockets
from sharedstate.ss_server import SharedStateServer, MsgType, MsgCmd


@pytest.fixture
async def server(tmp_path):
    stores_config = [
        {
            "name": "mitems",
            "module": "items_store",
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
        port=0,
        http_log=http_log,
        ws_log=ws_log,
        stores=stores_config
    )
    for store in srv._stores.values():
        await store.open()

    srv._ws_server = await websockets.serve(
        srv._handle_ws_client,
        srv._host,
        srv._port,
        process_request=srv._process_http_request
    )

    port = srv._ws_server.sockets[0].getsockname()[1]
    srv._port = port

    yield srv, port

    await srv.shutdown()


def make_ws_client(port):
    return websockets.connect(f"ws://127.0.0.1:{port}")


async def send_ws_request(ws, cmd, path, data=None):
    req = {
        "type": MsgType.REQUEST,
        "cmd": cmd,
        "path": path,
    }
    if data is not None:
        req["data"] = data
    await ws.send(json.dumps(req))
    resp = await ws.recv()
    return json.loads(resp)


def _sync_http_get_json(port, path):
    url = f"http://127.0.0.1:{port}{path}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return resp.status, json.loads(resp.read().decode('utf-8'))


async def http_get_json(port, path):
    return await asyncio.to_thread(_sync_http_get_json, port, path)


def _sync_http_get_raw(port, path):
    url = f"http://127.0.0.1:{port}{path}"
    with urllib.request.urlopen(url) as resp:
        return resp.status, resp.read().decode('utf-8')


async def http_get_raw(port, path):
    return await asyncio.to_thread(_sync_http_get_raw, port, path)


# =====================================================================
# WEBSOCKET TESTS
# =====================================================================

@pytest.mark.asyncio
async def test_ws_get_stores(server):
    _, port = server
    async with make_ws_client(port) as ws:
        reply = await send_ws_request(ws, MsgCmd.GET, "/")
        assert reply["type"] == MsgType.REPLY
        assert reply["ok"] is True
        assert "mitems" in reply["data"]


@pytest.mark.asyncio
async def test_ws_get_clock(server):
    _, port = server
    async with make_ws_client(port) as ws:
        reply = await send_ws_request(ws, MsgCmd.GET, "/clock")
        assert reply["type"] == MsgType.REPLY
        assert reply["ok"] is True
        assert isinstance(reply["data"], (int, float))
        assert reply["data"] > 0


@pytest.mark.asyncio
async def test_ws_items_crud(server):
    _, port = server
    async with make_ws_client(port) as ws:
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
    _, port = server
    sub_path = "/app/mitems/chnl"

    async with make_ws_client(port) as ws_a, make_ws_client(port) as ws_b:
        sub_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "data": {"insert": [[sub_path, {}]], "reset": True}
        }
        await ws_a.send(json.dumps(sub_req))
        assert json.loads(await ws_a.recv())["type"] == MsgType.REPLY
        assert json.loads(await ws_a.recv())["type"] == MsgType.MESSAGE

        item = {"id": "b_item", "data": "b_data"}
        await ws_b.send(json.dumps({
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": sub_path,
            "data": {"insert": [item]}
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
async def test_http_stores_list(server):
    _, port = server
    status, data = await http_get_json(port, "/api/stores")
    assert status == 200
    store_names = [s["name"] if isinstance(s, dict) else s for s in data["data"]]
    assert "mitems" in store_names


@pytest.mark.asyncio
async def test_http_rest_hierarchy(server):
    _, port = server
    path = "/app/mitems/chnl"

    # Insert items via WS
    async with make_ws_client(port) as ws:
        await send_ws_request(ws, MsgCmd.PUT, path, {"insert": [{"id": "h1", "data": "test"}]})

    # 1. GET /api/stores/mitems/ -> list app names
    status, res = await http_get_json(port, "/api/stores/mitems/")
    assert status == 200
    assert res["ok"] is True
    assert "app" in res["data"]

    # 2. GET /api/stores/mitems/app/ -> list channel names
    status, res = await http_get_json(port, "/api/stores/mitems/app/")
    assert status == 200
    assert res["ok"] is True
    assert "chnl" in res["data"]

    # 3. GET /api/stores/mitems/app/chnl -> list items
    status, res = await http_get_json(port, "/api/stores/mitems/app/chnl")
    assert status == 200
    assert res["ok"] is True
    assert len(res["data"]) == 1
    assert res["data"][0]["id"] == "h1"


@pytest.mark.asyncio
async def test_http_subs_and_connections(server):
    _, port = server

    async with make_ws_client(port) as ws:
        # Subscribe
        sub_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/subs",
            "data": {"insert": [["/app/mitems/chnl", {}]], "reset": True}
        }
        await ws.send(json.dumps(sub_req))
        await ws.recv()  # REPLY
        await ws.recv()  # NOTIFY

        # Query HTTP /api/connections
        status, conns_res = await http_get_json(port, "/api/connections")
        assert status == 200
        assert conns_res["ok"] is True
        assert len(conns_res["data"]) == 1

        # Query HTTP /api/subs
        status, subs_res = await http_get_json(port, "/api/subs")
        assert status == 200
        assert subs_res["ok"] is True
        assert len(subs_res["data"]) == 1
        assert subs_res["data"][0]["path"] == "/app/mitems/chnl"


@pytest.mark.asyncio
async def test_http_clock(server):
    _, port = server
    status, res = await http_get_json(port, "/api/clock")
    assert status == 200
    assert res["ok"] is True
    assert isinstance(res["data"], (int, float))
    assert res["data"] > 0


@pytest.mark.asyncio
async def test_http_static_explorer_ui(server):
    _, port = server
    status, content = await http_get_raw(port, "/files/adm/index.html")
    assert status == 200
    assert "<title>SharedState - Overview</title>" in content

    # Test /files/ prefix asset serving
    status, content_files = await http_get_raw(port, "/files/demo.html")
    assert status == 200
    assert "SharedMap Viewer" in content_files

    # Test /files/ directory listing
    status, content_dir = await http_get_raw(port, "/files/")
    assert status == 200
    assert "Index of /files/" in content_dir
    assert "demo.html" in content_dir
    assert "minimal.html" in content_dir


@pytest.mark.asyncio
async def test_server_versioning_and_conditional_updates(server):
    _, port = server
    async with make_ws_client(port) as ws:
        tunnel_payload = {
            "client_id": "client_test_1",
            "request_count": 1,
            "update_count": 1
        }

        # 1. Regular update (no last_version)
        put_req = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/resources/app/mitems/res1",
            "data": {
                "insert": [{"id": "item1", "val": "a"}]
            },
            "tunnel": tunnel_payload
        }
        await ws.send(json.dumps(put_req))
        reply = json.loads(await ws.recv())

        assert reply["ok"] is True
        assert reply["tunnel"] == tunnel_payload

        # 2. Conditional update with correct last_version (1)
        put_cond_ok = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/resources/app/mitems/res1",
            "data": {
                "insert": [{"id": "item1", "val": "b"}],
                "last_version": 1
            },
            "tunnel": tunnel_payload
        }
        await ws.send(json.dumps(put_cond_ok))
        reply_cond = json.loads(await ws.recv())

        assert reply_cond["ok"] is True

        # 3. Conditional update with stale last_version (1) -> SHOULD FAIL with VERSION_MISMATCH
        put_cond_fail = {
            "type": MsgType.REQUEST,
            "cmd": MsgCmd.PUT,
            "path": "/resources/app/mitems/res1",
            "data": {
                "insert": [{"id": "item1", "val": "stale"}],
                "last_version": 1  # Server version is now 2!
            },
            "tunnel": tunnel_payload
        }
        await ws.send(json.dumps(put_cond_fail))
        reply_fail = json.loads(await ws.recv())

        assert reply_fail["ok"] is False
        assert reply_fail["data"]["error"] == "VERSION_MISMATCH"
        assert reply_fail["data"]["current_version"] == 2


@pytest.mark.asyncio
async def test_monotonic_wall_clock_behavior():
    from sharedstate.ss_clock import MonotonicWallClock
    from unittest.mock import patch
    import time

    clock = MonotonicWallClock(max_slew_rate=0.10, sync_threshold=0.001)
    t1 = clock.now()
    await asyncio.sleep(0.05)
    t2 = clock.now()

    assert isinstance(t1, float)
    assert isinstance(t2, float)
    assert t2 > t1
    assert t1 > 1_700_000_000  # Reasonable timestamp in seconds since epoch

    # Test backward system time jump simulation: system clock drops by 10s
    with patch("time.time", return_value=t2 - 10.0):
        t3 = clock.now()
        assert t3 >= t2  # Monotonicity invariant: MUST NOT jump backward!

    # Test forward system time jump simulation: system clock jumps ahead by 10s
    with patch("time.time", return_value=t2 + 10.0):
        t4 = clock.now()
        assert t4 > t3  # Advances smoothly forward

