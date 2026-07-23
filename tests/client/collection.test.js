import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/ss_collection.js";

describe("ProxyCollection Unit Tests", () => {
    function createMockClient() {
        return {
            update: vi.fn().mockResolvedValue({ ok: true })
        };
    }

    test("initial state is empty", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");
        expect(coll.size).toBe(0);
        expect(coll.get_items()).toEqual([]);
        expect(coll.has_item("1")).toBe(false);
        expect(coll.get_item("1")).toBeUndefined();
    });

    test("handles insert, replace, and delete updates with callback diffs", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");

        const callback = vi.fn();
        coll.add_callback(callback);

        // 1. Insert item1
        coll._ssclient_update({
            remove: [],
            insert: [{ id: "item1", state: "foo" }],
            reset: false
        });

        expect(coll.size).toBe(1);
        expect(coll.has_item("item1")).toBe(true);
        expect(coll.get_item("item1")).toEqual({ id: "item1", state: "foo" });
        expect(callback).toHaveBeenLastCalledWith([
            { id: "item1", new: { id: "item1", state: "foo" }, old: undefined }
        ]);

        // 2. Replace item1
        coll._ssclient_update({
            remove: [],
            insert: [{ id: "item1", state: "bar" }],
            reset: false
        });

        expect(coll.size).toBe(1);
        expect(coll.get_item("item1")).toEqual({ id: "item1", state: "bar" });
        expect(callback).toHaveBeenLastCalledWith([
            { id: "item1", new: { id: "item1", state: "bar" }, old: { id: "item1", state: "foo" } }
        ]);

        // 3. Delete item1
        coll._ssclient_update({
            remove: ["item1"],
            insert: [],
            reset: false
        });

        expect(coll.size).toBe(0);
        expect(coll.has_item("item1")).toBe(false);
        expect(callback).toHaveBeenLastCalledWith([
            { id: "item1", new: undefined, old: { id: "item1", state: "bar" } }
        ]);
    });

    test("handles reset update", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");

        coll._ssclient_update({
            insert: [{ id: "i1", val: 1 }, { id: "i2", val: 2 }]
        });
        expect(coll.size).toBe(2);

        const callback = vi.fn();
        coll.add_callback(callback);

        // Reset with new item
        coll._ssclient_update({
            insert: [{ id: "i3", val: 3 }],
            reset: true
        });

        expect(coll.size).toBe(1);
        expect(coll.get_item("i3")).toEqual({ id: "i3", val: 3 });
        expect(callback).toHaveBeenCalled();
    });

    test("update_items auto-generates id if missing and delegates to client", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");

        coll.update_items({ insert: [{ data: "no_id" }] });

        expect(mockClient.update).toHaveBeenCalledTimes(1);
        const [path, changes] = mockClient.update.mock.calls[0];
        expect(path).toBe("/app/mitems/chnl");
        expect(changes.insert[0].id).toBeDefined();
        expect(typeof changes.insert[0].id).toBe("string");
        expect(changes.insert[0].data).toBe("no_id");
    });

    test("termination prevents updates", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");

        coll._ssclient_terminate();

        expect(() => {
            coll._ssclient_update({ insert: [{ id: "i1" }] });
        }).toThrow("collection already terminated");

        expect(() => {
            coll.update_items({ insert: [{ id: "i1" }] });
        }).toThrow("collection already terminated");
    });
});
