import { describe, test, expect, vi } from "vitest";
import { ItemProvider } from "../../client/provider.js";
import { OptimisticItemProvider } from "../../client/opt_provider.js";
import { SharedInteger } from "../../client/objects/variables.js";
import { SharedMap } from "../../client/objects/map.js";
import { ItemReader, ItemUpdater } from "../../client/reader_updater.js";

import { SharedStateClient } from "../../client/client.js";

function createMockClient() {
    const client = {
        id: "client_test_spec_1",
        _update_count: 0,
        _last_acked_update_count: 0,
        _pending_updates: new Map(),
        _providers: new Map(),
        _path_bindings: new Map(),
        _item_bindings: new Map(),
        _options: { failureTimeout: 10 },
        _request: vi.fn(),
        _reconnect: vi.fn(),
        _on_ack: SharedStateClient.prototype._on_ack,
        _check_pending_timeouts: SharedStateClient.prototype._check_pending_timeouts,
        provider(token, collPath, itemID = undefined, options = {}) {
            if (!this._providers.has(collPath)) {
                const baseColl = new ItemProvider(this, collPath, options);
                const coll = new OptimisticItemProvider(this, baseColl, options);
                this._providers.set(collPath, coll);
            }
            const providerInstance = this._providers.get(collPath);
            if (itemID === undefined) {
                const reader = providerInstance;
                const updater = {
                    update_items: (changes, opts) => providerInstance._update_items(changes, opts),
                    clear: () => providerInstance._update_items({ reset: true })
                };
                return [reader, updater];
            } else {
                const reader = new ItemReader(providerInstance, itemID);
                const updater = new ItemUpdater(providerInstance, itemID);
                return [reader, updater];
            }
        }
    };
    client._request.mockImplementation(async (cmd, path, data) => {
        if (cmd === "PUT" && path !== "/subs") {
            client._update_count++;
            client._pending_updates.set(client._update_count, { timestamp: Date.now(), path, changes: data });
        }
        return { ok: true, data: {} };
    });
    return client;
}

describe("OptimisticItemProvider Unit Tests", () => {
    test("instantiates OptimisticItemProvider wrapping ItemProvider and reports optimistic property", () => {
        const mockClient = createMockClient();
        const baseColl = new ItemProvider(mockClient, "/app/store/res1");
        const specColl = new OptimisticItemProvider(mockClient, baseColl);

        expect(baseColl.optimistic).toBe(false);
        expect(specColl.optimistic).toBe(true);
        expect(specColl.path).toBe("/app/store/res1");
        expect(specColl.provider).toBe(baseColl);
        expect(specColl.size).toBe(0);
    });

    test("speculative queries (get_item, has_item, size, get_items) overlay server state on microtask tick", async () => {
        const mockClient = createMockClient();
        const baseColl = new ItemProvider(mockClient, "/resources/app/store/res1");
        const specColl = new OptimisticItemProvider(mockClient, baseColl);

        // Populate base collection with server snapshot
        baseColl._client_update({
            insert: [{ id: "item1", state: 100 }],
            reset: true
        });

        expect(specColl.has_item("item1")).toBe(true);
        expect(specColl.get_item("item1")).toEqual({ id: "item1", state: 100 });
        expect(specColl.size).toBe(1);

        // Perform speculative update: set item1 = 200, insert item2 = 300
        const callback = vi.fn();
        specColl.add_callback(callback);

        specColl._update_items({
            insert: [
                { id: "item1", state: 200 },
                { id: "item2", state: 300 }
            ]
        });

        // Microtask tick flushes overlay write
        await Promise.resolve();

        expect(specColl.get_item("item1")).toEqual({ id: "item1", state: 200 });
        expect(specColl.get_item("item2")).toEqual({ id: "item2", state: 300 });
        expect(specColl.size).toBe(2);
        expect(callback).toHaveBeenCalledTimes(1);

        // Underlying server collection is NOT touched by write!
        expect(baseColl.get_item("item1")).toEqual({ id: "item1", state: 100 });
        expect(baseColl.get_item("item2")).toBeUndefined();
    });

    test("speculative deletion via tombstone", async () => {
        const mockClient = createMockClient();
        const baseColl = new ItemProvider(mockClient, "/resources/app/store/members");
        const specColl = new OptimisticItemProvider(mockClient, baseColl);

        baseColl._client_update({ insert: [{ id: "alice", state: "active" }] });
        expect(specColl.has_item("alice")).toBe(true);

        specColl._update_items({ remove: ["alice"] });
        await Promise.resolve();

        expect(specColl.has_item("alice")).toBe(false);
        expect(specColl.get_item("alice")).toBeUndefined();
        expect(specColl.size).toBe(0);

        // Underlying server collection still has item until server ACK
        expect(baseColl.has_item("alice")).toBe(true);
    });

    test("1 + N sequence-based eviction when server ACK arrives", async () => {
        const mockClient = createMockClient();
        const baseColl = new ItemProvider(mockClient, "/resources/app/store/vars");
        const specColl = new OptimisticItemProvider(mockClient, baseColl);

        // Local edit 1 in tick 1
        const p1 = specColl._update_items({ insert: [{ id: "score", state: 10 }] });
        await new Promise(r => queueMicrotask(r));
        await p1;

        // Local edit 2 in tick 2
        const p2 = specColl._update_items({ insert: [{ id: "score", state: 20 }] });
        await new Promise(r => queueMicrotask(r));
        await p2;

        expect(specColl.get_item("score")).toEqual({ id: "score", state: 20 });

        // Server sends ACK 1 for update_count 1 (our client_id)
        specColl._client_update(
            { insert: [{ id: "score", state: 10 }] },
            { client_id: "client_test_spec_1", update_count: 1 }
        );

        // Since overlay has update_count 2 > last_acked 1, score STAYS 20 (no flicker!)
        expect(specColl.get_item("score")).toEqual({ id: "score", state: 20 });

        // Server sends ACK 2 for update_count 2
        specColl._client_update(
            { insert: [{ id: "score", state: 20 }] },
            { client_id: "client_test_spec_1", update_count: 2 }
        );

        // Now overlay is evicted (count 2 <= last_acked 2)
        expect(specColl.get_item("score")).toEqual({ id: "score", state: 20 });
        expect(baseColl.get_item("score")).toEqual({ id: "score", state: 20 });
    });

    test("remote client edit updates base collection while local speculative overlay stays active", async () => {
        const mockClient = createMockClient();
        const baseColl = new ItemProvider(mockClient, "/resources/app/store/vars");
        const specColl = new OptimisticItemProvider(mockClient, baseColl);

        // Local edit at update_count 1
        specColl._update_items({ insert: [{ id: "score", state: 50 }] });
        await Promise.resolve();

        // Remote client (client_remote_99) sends update
        specColl._client_update(
            { insert: [{ id: "score", state: 30 }] },
            { client_id: "client_remote_99", update_count: 5 }
        );

        // Base collection gets remote update (30)
        expect(baseColl.get_item("score")).toEqual({ id: "score", state: 30 });

        // Speculative facade still displays local overlay (50) until own ACK arrives
        expect(specColl.get_item("score")).toEqual({ id: "score", state: 50 });
    });

    test("Layer 2 integration (SharedInteger and SharedMap) over OptimisticItemProvider", async () => {
        const mockClient = createMockClient();

        const num = new SharedInteger(mockClient, "/app/store/vars", "score", { allowUndefined: false });
        const mapObj = new SharedMap(mockClient, "/app/store/maps");

        expect(num.value).toBe(0);

        // Local value update on microtask tick
        num.inc(5);
        await Promise.resolve();
        expect(num.value).toBe(5);

        mapObj.set("theme", "dark");
        await Promise.resolve();
        expect(mapObj.get("theme")).toBe("dark");
    });

    test("REPLY(ok: false) evicts speculative overlay and reverts UI state immediately", async () => {
        const mockClient = createMockClient();
        const baseColl = new ItemProvider(mockClient, "/resources/app/store/vars");
        const specColl = new OptimisticItemProvider(mockClient, baseColl);
        mockClient._providers.set("/resources/app/store/vars", specColl);

        // Client performs speculative update
        specColl._update_items({ insert: [{ id: "counter", state: 10 }] });
        await Promise.resolve();
        expect(specColl.get_item("counter")).toEqual({ id: "counter", state: 10 });

        // Server sends REPLY(ok: false) for update_count 1
        specColl._client_ack(1, false);

        // Speculative overlay is evicted and state reverts
        expect(specColl.get_item("counter")).toBeUndefined();
    });

    test("detects un-ACKed gap in pending_updates and triggers reconnect", () => {
        const mockClient = createMockClient();
        mockClient._reconnect = vi.fn();

        mockClient._pending_updates.set(1, { timestamp: Date.now(), path: "/resources/app/store/res", changes: {} });
        mockClient._pending_updates.set(2, { timestamp: Date.now(), path: "/resources/app/store/res", changes: {} });

        // ACK for update 2 arrives while update 1 is still in pending_updates
        mockClient._on_ack(2, true, "/resources/app/store/res");

        expect(mockClient._reconnect).toHaveBeenCalled();
    });

    test("triggers reconnect when pending update exceeds failureTimeout and state is CONNECTED", () => {
        const mockClient = createMockClient();
        mockClient._connection = { state: "connected", reconnect: vi.fn() };
        mockClient._reconnect = vi.fn(() => mockClient._connection.reconnect(true));

        // Insert pending update with timestamp in past (15 seconds ago)
        mockClient._pending_updates.set(1, { timestamp: Date.now() - 15000, path: "/resources/app/store/res", changes: {} });

        mockClient._check_pending_timeouts();

        expect(mockClient._connection.reconnect).toHaveBeenCalledWith(true);
    });

    test("defaults failureTimeout option to 10 when invalid or unprovided", () => {
        const clientInvalid = new SharedStateClient("ws://localhost:9000", { failureTimeout: "invalid" });
        expect(clientInvalid._options.failureTimeout).toBe(10);

        const clientCustom = new SharedStateClient("ws://localhost:9000", { failureTimeout: 20 });
        expect(clientCustom._options.failureTimeout).toBe(20);
    });
});
