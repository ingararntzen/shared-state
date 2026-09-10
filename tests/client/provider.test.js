import { describe, test, expect, vi } from "vitest";
import { ItemProvider } from "../../client/providers/item_provider.js";

describe("ItemProvider Unit Tests", () => {
    function createMockClient() {
        return {
            _update: vi.fn().mockResolvedValue({ ok: true })
        };
    }

    test("initial state is empty", () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");
        expect(coll.size).toBe(0);
        expect(coll.get_items()).toEqual([]);
        expect(coll.has_item("1")).toBe(false);
        expect(coll.get_item("1")).toBeUndefined();
    });

    test("handles insert, replace, and delete updates with callback diffs", () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        const callback = vi.fn();
        coll.add_callback(callback);

        // 1. Insert item1
        coll._client_update({
            remove: [],
            insert: [{ id: "item1", state: "foo" }],
            reset: false
        });

        expect(coll.size).toBe(1);
        expect(coll.has_item("item1")).toBe(true);
        expect(coll.get_item("item1")).toEqual({ id: "item1", state: "foo" });
        expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
            remove: new Set(),
            insert: new Map([["item1", { id: "item1", state: "foo" }]]),
            reset: false
        }));

        // 2. Replace item1
        coll._client_update({
            remove: [],
            insert: [{ id: "item1", state: "bar" }],
            reset: false
        });

        expect(coll.size).toBe(1);
        expect(coll.get_item("item1")).toEqual({ id: "item1", state: "bar" });
        expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
            remove: new Set(),
            insert: new Map([["item1", { id: "item1", state: "bar" }]]),
            reset: false
        }));

        // 3. Delete item1
        coll._client_update({
            remove: ["item1"],
            insert: [],
            reset: false
        });

        expect(coll.size).toBe(0);
        expect(coll.has_item("item1")).toBe(false);
        expect(callback).toHaveBeenLastCalledWith(expect.objectContaining({
            remove: new Set(["item1"]),
            insert: new Map(),
            reset: false
        }));
    });

    test("handles reset update", () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        coll._client_update({
            insert: [{ id: "i1", val: 1 }, { id: "i2", val: 2 }]
        });
        expect(coll.size).toBe(2);

        const callback = vi.fn();
        coll.add_callback(callback);

        // Reset with new item
        coll._client_update({
            insert: [{ id: "i3", val: 3 }],
            reset: true
        });

        expect(coll.size).toBe(1);
        expect(coll.get_item("i3")).toEqual({ id: "i3", val: 3 });
        expect(callback).toHaveBeenCalled();
    });

    test("_update_items auto-generates id if missing and delegates to client", async () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        const p = coll._update_items({ insert: [{ data: "no_id" }] });
        await p;

        expect(mockClient._update).toHaveBeenCalledTimes(1);
        const [path, changes] = mockClient._update.mock.calls[0];
        expect(path).toBe("/app/mitems/chnl");
        expect(changes.insert[0].id).toBeDefined();
        expect(typeof changes.insert[0].id).toBe("string");
        expect(changes.insert[0].data).toBe("no_id");
    });

    test("termination prevents updates", () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        coll._client_terminate();

        expect(() => {
            coll._client_update({ insert: [{ id: "i1" }] });
        }).toThrow("collection already terminated");

        expect(() => {
            coll._update_items({ insert: [{ id: "i1" }] });
        }).toThrow("collection already terminated");
    });

    test("batches multiple synchronous _update_items calls into 1 microtask request", async () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        const p1 = coll._update_items({ insert: [{ id: "item1", state: "val1" }] });
        const p2 = coll._update_items({ insert: [{ id: "item1", state: "val2" }] }); // Overwrites item1
        const p3 = coll._update_items({ insert: [{ id: "item2", state: "val3" }] });

        expect(p1).toBe(p2);
        expect(p2).toBe(p3);

        const res = await p1;
        expect(res.ok).toBe(true);
        expect(mockClient._update).toHaveBeenCalledTimes(1);
        const [path, changes] = mockClient._update.mock.calls[0];
        expect(path).toBe("/app/mitems/chnl");
        expect(changes.insert).toEqual([
            { id: "item1", state: "val2" },
            { id: "item2", state: "val3" }
        ]);
    });

    test("detects version gap and triggers client reconnect", () => {
        const mockClient = createMockClient();
        mockClient._reconnect = vi.fn();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        // Initial version 4
        coll._client_update({ reset: true, version: 4, insert: [{ id: "1" }] });
        expect(coll._version).toBe(4);

        // Normal increment v5 -> accepted
        coll._client_update({ version: 5, insert: [{ id: "2" }] });
        expect(coll._version).toBe(5);

        // Duplicate/stale v5 -> ignored
        coll._client_update({ version: 5, insert: [{ id: "2_dup" }] });
        expect(coll.has_item("2_dup")).toBe(false);

        // Version gap: incoming v7 > local v5 + 1 -> triggers reconnect
        coll._client_update({ version: 7, insert: [{ id: "4" }] });
        expect(mockClient._reconnect).toHaveBeenCalledWith("version_gap");
    });

    test("dropIfModified option attaches last_version to payload data", async () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");

        // Set version via server snapshot update
        coll._client_update({ version: 10, reset: true });
        expect(coll._version).toBe(10);

        // Perform update with dropIfModified: true
        await coll._update_items({ insert: [{ id: "i1", state: "v1" }] }, { dropIfModified: true });

        expect(mockClient._update).toHaveBeenCalledWith("/app/mitems/chnl", {
            insert: [{ id: "i1", state: "v1" }],
            remove: [],
            reset: false,
            last_version: 10
        });
    });

    test("SingleItemProvider emits { new, old } value diff in callbacks", async () => {
        const mockClient = createMockClient();
        const coll = new ItemProvider(mockClient, "/app/mitems/chnl");
        const { SingleItemProvider } = await import("../../client/providers/single_item_provider.js");
        const itemRes = new SingleItemProvider(coll, "score");

        expect(itemRes.name).toBe("score");
        expect(itemRes.provider).toBe(coll);
        expect(itemRes.is_initialized()).toBe(false);
        expect(itemRes.get()).toBeUndefined();

        const callback = vi.fn();
        const handle = itemRes.add_callback(callback);

        // 1. Initial item update (undefined -> 100)
        coll._client_update({
            insert: [{ id: "score", state: 100 }]
        });
        expect(itemRes.is_initialized()).toBe(true);
        expect(itemRes.get()).toBe(100);
        expect(callback).toHaveBeenLastCalledWith({ new: 100, old: undefined });

        // 2. Unrelated item update -> score callback not called again
        coll._client_update({
            insert: [{ id: "other", state: "abc" }]
        });
        expect(callback).toHaveBeenCalledTimes(1);

        // 3. Value change (100 -> 200)
        coll._client_update({
            insert: [{ id: "score", state: 200 }]
        });
        expect(callback).toHaveBeenLastCalledWith({ new: 200, old: 100 });

        // 4. Removal (200 -> undefined)
        coll._client_update({
            remove: ["score"]
        });
        expect(callback).toHaveBeenLastCalledWith({ new: undefined, old: 200 });

        // Unsubscribe
        itemRes.remove_callback(handle);
        coll._client_update({
            insert: [{ id: "score", state: 300 }]
        });
        expect(callback).toHaveBeenCalledTimes(3);
    });
});
