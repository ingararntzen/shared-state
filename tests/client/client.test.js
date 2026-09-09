import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { SharedStateClient } from "../../client/client.js";
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
        "name": "mitems", "module": "item_store",
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

    test("load(client, config) with SharedMap operations and querying", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const { itemsMap } = load(client, {
            itemsMap: { type: "Map", path: "/app/mitems/chnl" }
        });
        const coll = itemsMap.provider;

        // 1. Insert item
        const insertRes = await itemsMap.set("item1", { data: "first" });
        expect(insertRes.ok).toBe(true);

        // Wait for notification sync to proxy collection
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(coll.size).toBe(1);
        expect(itemsMap.has("item1")).toBe(true);
        expect(itemsMap.get("item1")).toEqual({ data: "first" });

        // 2. Remove item1
        const removeRes = await itemsMap.delete("item1");
        expect(removeRes.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(coll.size).toBe(0);
        expect(itemsMap.has("item1")).toBe(false);

        // 3. Reset collection
        const resetRes = await itemsMap.clear();
        expect(resetRes.ok).toBe(true);

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

    test("client.get_provider(token, path) acquires and returns [reader, updater]", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const [r1, u1] = client.get_provider("AppLayer", "/app/mitems/layer1");
        const [r2, u2] = client.get_provider("AppLayer", "/app/mitems/layer1");

        expect(r1).toBeDefined();
        expect(u1).toBeDefined();
        expect(r1).toBe(r2);

        client.terminate();
    });

    test("enforces path-exclusive and item-exclusive binding locks", () => {
        const client = new SharedStateClient(SERVER_URL);

        // Path-exclusive binding
        client.get_provider("AppA", "/app/mitems/path1");
        expect(() => client.get_provider("AppB", "/app/mitems/path1")).toThrow("is already bound to token 'AppA'");
        expect(() => client.get_provider("AppA", "/app/mitems/path1", "item1")).toThrow("is already bound to token 'AppA' (path-exclusive)");

        // Item-exclusive binding
        client.get_provider("AppC", "/app/mitems/path2", "var1");
        expect(() => client.get_provider("AppD", "/app/mitems/path2")).toThrow("already has item-exclusive bindings");
        expect(() => client.get_provider("AppE", "/app/mitems/path2", "var1")).toThrow("item 'var1' is already bound to token 'AppC'");

        // Same token on same item -> succeeds
        const [r, u] = client.get_provider("AppC", "/app/mitems/path2", "var1");
        expect(r).toBeDefined();

        client.terminate();
    });
});
