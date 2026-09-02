import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/ss_collection.js";
import { OptimisticProxyCollection } from "../../client/ss_optimistic_collection.js";
import { SharedInteger } from "../../client/variables/variables.js";
import { SharedMap } from "../../client/collections/map.js";

import { SharedStateClient } from "../../client/ss_client.js";

function createMockClient() {
    const client = {
        id: "client_test_spec_1",
        _update_count: 0,
        _last_acked_update_count: 0,
        _pending_updates: new Map(),
        _coll_map: new Map(),
        _weakObjects: new Map(),
        _coll_paths: new Set(),
        _var_coll_paths: new Set(),
        _ttlMs: 10000,
        _request: vi.fn(),
        _handle_version_gap: vi.fn(),
        _on_ack: SharedStateClient.prototype._on_ack,
        _check_pending_timeouts: SharedStateClient.prototype._check_pending_timeouts,
        _get_weak_object(path) {
            const ref = this._weakObjects.get(path);
            return ref ? ref.deref() || null : null;
        },
        _set_weak_object(path, obj) {
            this._weakObjects.set(path, new WeakRef(obj));
        },
        collection(collPath, options = {}) {
            if (!this._coll_map.has(collPath)) {
                const baseColl = new ProxyCollection(this, collPath, options);
                const isOptimistic = options.optimistic ?? true;
                const coll = isOptimistic ? new OptimisticProxyCollection(this, baseColl, options) : baseColl;
                this._coll_map.set(collPath, coll);
            }
            return this._coll_map.get(collPath);
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

describe("OptimisticProxyCollection Unit Tests", () => {
    test("instantiates OptimisticProxyCollection wrapping ProxyCollection and reports optimistic property", () => {
        const mockClient = createMockClient();
        const baseColl = new ProxyCollection(mockClient, "/app/store/res1");
        const specColl = new OptimisticProxyCollection(mockClient, baseColl);

        expect(baseColl.optimistic).toBe(false);
        expect(specColl.optimistic).toBe(true);
        expect(specColl.path).toBe("/app/store/res1");
        expect(specColl.provider).toBe(baseColl);
        expect(specColl.size).toBe(0);
    });

    test("speculative queries (get_item, has_item, size, get_items) overlay server state on microtask tick", async () => {
        const mockClient = createMockClient();
        const baseColl = new ProxyCollection(mockClient, "/resources/app/store/res1");
        const specColl = new OptimisticProxyCollection(mockClient, baseColl);

        // Populate base collection with server snapshot
        baseColl._ssclient_update({
            insert: [{ id: "item1", state: 100 }],
            reset: true
        });

        expect(specColl.has_item("item1")).toBe(true);
        expect(specColl.get_item("item1")).toEqual({ id: "item1", state: 100 });
        expect(specColl.size).toBe(1);

        // Perform speculative update: set item1 = 200, insert item2 = 300
        const callback = vi.fn();
        specColl.add_callback(callback);

        specColl.update_items({
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
        const baseColl = new ProxyCollection(mockClient, "/resources/app/store/members");
        const specColl = new OptimisticProxyCollection(mockClient, baseColl);

        baseColl._ssclient_update({ insert: [{ id: "alice", state: "active" }] });
        expect(specColl.has_item("alice")).toBe(true);

        specColl.update_items({ remove: ["alice"] });
        await Promise.resolve();

        expect(specColl.has_item("alice")).toBe(false);
        expect(specColl.get_item("alice")).toBeUndefined();
        expect(specColl.size).toBe(0);

        // Underlying server collection still has item until server ACK
        expect(baseColl.has_item("alice")).toBe(true);
    });

    test("1 + N sequence-based eviction when server ACK arrives", async () => {
        const mockClient = createMockClient();
        const baseColl = new ProxyCollection(mockClient, "/resources/app/store/vars");
        const specColl = new OptimisticProxyCollection(mockClient, baseColl);

        // Local edit 1 in tick 1
        const p1 = specColl.update_items({ insert: [{ id: "score", state: 10 }] });
        await new Promise(r => queueMicrotask(r));
        await p1;

        // Local edit 2 in tick 2
        const p2 = specColl.update_items({ insert: [{ id: "score", state: 20 }] });
        await new Promise(r => queueMicrotask(r));
        await p2;

        expect(specColl.get_item("score")).toEqual({ id: "score", state: 20 });

        // Server sends ACK 1 for update_count 1 (our client_id)
        specColl._ssclient_update(
            { insert: [{ id: "score", state: 10 }] },
            { client_id: "client_test_spec_1", update_count: 1 }
        );

        // Since overlay has update_count 2 > last_acked 1, score STAYS 20 (no flicker!)
        expect(specColl.get_item("score")).toEqual({ id: "score", state: 20 });

        // Server sends ACK 2 for update_count 2
        specColl._ssclient_update(
            { insert: [{ id: "score", state: 20 }] },
            { client_id: "client_test_spec_1", update_count: 2 }
        );

        // Now overlay is evicted (count 2 <= last_acked 2)
        expect(specColl.get_item("score")).toEqual({ id: "score", state: 20 });
        expect(baseColl.get_item("score")).toEqual({ id: "score", state: 20 });
    });

    test("remote client edit updates base collection while local speculative overlay stays active", async () => {
        const mockClient = createMockClient();
        const baseColl = new ProxyCollection(mockClient, "/resources/app/store/vars");
        const specColl = new OptimisticProxyCollection(mockClient, baseColl);

        // Local edit at update_count 1
        specColl.update_items({ insert: [{ id: "score", state: 50 }] });
        await Promise.resolve();

        // Remote client (client_remote_99) sends update
        specColl._ssclient_update(
            { insert: [{ id: "score", state: 30 }] },
            { client_id: "client_remote_99", update_count: 5 }
        );

        // Base collection gets remote update (30)
        expect(baseColl.get_item("score")).toEqual({ id: "score", state: 30 });

        // Speculative facade still displays local overlay (50) until own ACK arrives
        expect(specColl.get_item("score")).toEqual({ id: "score", state: 50 });
    });

    test("Layer 2 integration (SharedInteger and SharedMap) over OptimisticProxyCollection", async () => {
        const mockClient = createMockClient();

        const num = new SharedInteger(mockClient, "/app/store/vars", "score");
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
        const baseColl = new ProxyCollection(mockClient, "/resources/app/store/vars");
        const specColl = new OptimisticProxyCollection(mockClient, baseColl);
        mockClient._coll_map.set("/resources/app/store/vars", specColl);

        // Client performs speculative update
        specColl.update_items({ insert: [{ id: "counter", state: 10 }] });
        await Promise.resolve();
        expect(specColl.get_item("counter")).toEqual({ id: "counter", state: 10 });

        // Server sends REPLY(ok: false) for update_count 1
        specColl._ssclient_ack(1, false);

        // Speculative overlay is evicted and state reverts
        expect(specColl.get_item("counter")).toBeUndefined();
    });

    test("detects un-ACKed gap in pending_updates and triggers reconnect", () => {
        const mockClient = createMockClient();
        mockClient._handle_version_gap = vi.fn();

        mockClient._pending_updates.set(1, { timestamp: Date.now(), path: "/resources/app/store/res", changes: {} });
        mockClient._pending_updates.set(2, { timestamp: Date.now(), path: "/resources/app/store/res", changes: {} });

        // ACK for update 2 arrives while update 1 is still in pending_updates
        mockClient._on_ack(2, true, "/resources/app/store/res");

        expect(mockClient._handle_version_gap).toHaveBeenCalled();
    });

    test("triggers reconnect when pending update exceeds ttlMs and state is CONNECTED", () => {
        const mockClient = createMockClient();
        mockClient._connection = { state: "connected", reconnect: vi.fn() };
        mockClient._handle_version_gap = vi.fn(() => mockClient._connection.reconnect(true));

        // Insert pending update with timestamp in past (15 seconds ago)
        mockClient._pending_updates.set(1, { timestamp: Date.now() - 15000, path: "/resources/app/store/res", changes: {} });

        mockClient._check_pending_timeouts();

        expect(mockClient._connection.reconnect).toHaveBeenCalledWith(true);
    });
});
