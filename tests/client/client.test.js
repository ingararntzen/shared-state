import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { SharedStateClient } from "../../client/ss_client.js";
import { load } from "../../client/load.js";

const PORT = 9099;
const SERVER_URL = `ws://127.0.0.1:${PORT}`;
let serverProc;

beforeAll(async () => {
    const pythonCode = `
import asyncio
from sharedstate.ss_server import SharedStateServer

config = [
    {
        "name": "mitems", "module": "items_store",
        "config": {"db_type": "sqlite", "db_name": ":memory:", "db_table": "items"}
    }
]
server = SharedStateServer(host="127.0.0.1", port=${PORT}, http_log=None, ws_log=None, stores=config)
asyncio.run(server.serve_forever())
`;

    serverProc = spawn("poetry", ["run", "python", "-c", pythonCode], {
        cwd: process.cwd(),
        stdio: "inherit"
    });

    // Wait for server to start listening
    await new Promise((resolve) => setTimeout(resolve, 1200));
}, 10000);

afterAll(() => {
    if (serverProc) {
        serverProc.kill("SIGTERM");
    }
});

describe("Client-Server Integration Tests", () => {
    test("connects and queries GET / (Services) and GET /clock (Clock)", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        // GET / (services)
        const servicesRes = await client._get("/");
        expect(servicesRes.ok).toBe(true);
        expect(servicesRes.data).toContain("mitems");

        // GET /clock
        const clockRes = await client._get("/clock");
        expect(clockRes.ok).toBe(true);
        expect(typeof clockRes.data).toBe("number");
        expect(clockRes.data).toBeGreaterThan(0);

        client.terminate();
    });

    test("load(client, config) with SharedMap: update_items (insert, remove, reset), and querying", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const { itemsMap } = load(client, {
            itemsMap: { type: "Map", path: "/app/mitems/chnl" }
        });
        const coll = itemsMap._proxyCollection;

        // 1. Insert items
        const insertRes = await coll.update_items({
            insert: [
                { id: "item1", data: "first" },
                { id: "item2", data: "second" }
            ]
        });
        expect(insertRes.ok).toBe(true);

        // Wait for notification sync to proxy collection
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(coll.size).toBe(2);
        expect(coll.has_item("item1")).toBe(true);
        expect(coll.get_item("item1")).toEqual({ id: "item1", data: "first" });

        // 2. Remove item1
        const removeRes = await coll.update_items({ remove: ["item1"] });
        expect(removeRes.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(coll.size).toBe(1);
        expect(coll.has_item("item1")).toBe(false);

        // 3. Reset collection
        const resetRes = await coll.update_items({
            insert: [{ id: "item3", data: "third" }],
            reset: true
        });
        expect(resetRes.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(coll.size).toBe(1);
        expect(coll.get_item("item3")).toEqual({ id: "item3", data: "third" });

        client.terminate();
    });

    test("load(client, config) with SharedInteger and SharedMap", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const { counter, settings } = load(client, {
            counter: { type: "Integer", path: "/app/mitems/counter_chnl" },
            settings: { type: "Map", path: "/app/mitems/settings_chnl" }
        });

        // Allow _sub PUT /subs request to settle on server
        await new Promise((resolve) => setTimeout(resolve, 150));

        const setRes = await counter.set(100);
        expect(setRes.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(counter.value).toBe(100);

        const mapRes = await settings.set("theme", "dark");
        expect(mapRes.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(settings.get("theme")).toBe("dark");

        client.terminate();
    });

    test("Real-time synchronization across two client instances", async () => {
        const clientA = new SharedStateClient(SERVER_URL);
        const clientB = new SharedStateClient(SERVER_URL);

        await Promise.all([clientA.connection.connectedPromise(), clientB.connection.connectedPromise()]);

        const { mapA } = load(clientA, {
            mapA: { type: "Map", path: "/app/mitems/sync_chnl" }
        });
        const { mapB } = load(clientB, {
            mapB: { type: "Map", path: "/app/mitems/sync_chnl" }
        });

        // Give subscription processing time to complete
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Client B updates map
        await mapB.set("shared_1", "from_B");

        // Client A should automatically receive update
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(mapA.has("shared_1")).toBe(true);
        expect(mapA.get("shared_1")).toBe("from_B");

        clientA.terminate();
        clientB.terminate();
    });

    test("client.collection(path) acquires and caches Layer 1 ProxyCollection", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const p1 = client.collection("/app/mitems/layer1");
        const p2 = client.collection("/app/mitems/layer1");

        expect(p1).toBeDefined();
        expect(p1).toBe(p2); // Reference equality: idempotent get-or-create

        client.terminate();
    });
});
