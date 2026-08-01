import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { SharedStateClient } from "../../client/ss_client.js";

const PORT = 9099;
const SERVER_URL = `ws://127.0.0.1:${PORT}`;
let serverProc;

beforeAll(async () => {
    const pythonCode = `
import asyncio
from sharedstate.ss_server import SharedStateServer

config = [
    {
        "name": "mitems", "module": "items_service",
        "config": {"db_type": "sqlite", "db_name": ":memory:", "db_table": "items"}
    }
]
server = SharedStateServer(host="127.0.0.1", port=${PORT}, http_log=None, ws_log=None, services=config)
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

describe("Client-Server Integration Tests (Obsoletes test.html)", () => {
    test("connects and queries GET / (Services) and GET /clock (Clock)", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        // GET / (services)
        const servicesRes = await client.get("/");
        expect(servicesRes.ok).toBe(true);
        expect(servicesRes.data).toContain("mitems");

        // GET /clock
        const clockRes = await client.get("/clock");
        expect(clockRes.ok).toBe(true);
        expect(typeof clockRes.data).toBe("number");
        expect(clockRes.data).toBeGreaterThan(0);

        client.release("/app/mitems/chnl");
    });

    test("acquire_collection, update_items (insert, remove, reset), and querying", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const coll = client.acquire_collection("/app/mitems/chnl");

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

        client.release("/app/mitems/chnl");
    });

    test("ProxyObject set_items and get_items", async () => {
        const client = new SharedStateClient(SERVER_URL);
        await client.connection.connectedPromise();

        const obj = client.acquire_object("/app/mitems/chnl", "my_object");

        const subItems = [
            { id: "sub1", name: "A" },
            { id: "sub2", name: "B" }
        ];

        const setRes = await obj.set_items(subItems);
        expect(setRes.ok).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(obj.get_items()).toEqual(subItems);
        expect(obj.has_item("sub1")).toBe(true);
        expect(obj.get_item("sub1")).toEqual({ id: "sub1", name: "A" });

        client.release("/app/mitems/chnl");
    });

    test("Real-time synchronization across two client instances", async () => {
        const clientA = new SharedStateClient(SERVER_URL);
        const clientB = new SharedStateClient(SERVER_URL);

        await Promise.all([clientA.connection.connectedPromise(), clientB.connection.connectedPromise()]);

        const path = "/app/mitems/sync_chnl";
        const collA = clientA.acquire_collection(path);
        const collB = clientB.acquire_collection(path);

        // Give subscription processing time to complete
        await new Promise((resolve) => setTimeout(resolve, 150));

        // Client B updates collection
        await collB.update_items({
            insert: [{ id: "shared_1", payload: "from_B" }]
        });

        // Client A should automatically receive update
        await new Promise((resolve) => setTimeout(resolve, 200));
        expect(collA.has_item("shared_1")).toBe(true);
        expect(collA.get_item("shared_1")).toEqual({ id: "shared_1", payload: "from_B" });

        clientA.release(path);
        clientB.release(path);
    });
});
