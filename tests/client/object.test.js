import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/ss_collection.js";
import { ProxyObject } from "../../client/ss_object.js";

describe("ProxyObject Unit Tests", () => {
    function createMockClient() {
        return {
            update: vi.fn().mockResolvedValue({ ok: true })
        };
    }

    test("initial state and querying methods", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");
        const obj = new ProxyObject(coll, "my_obj");

        expect(obj.get_items()).toEqual([]);
        expect(obj.has_item("sub1")).toBe(false);
        expect(obj.get_item("sub1")).toBeUndefined();
    });

    test("set_items delegates to ProxyCollection update_items", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");
        const obj = new ProxyObject(coll, "my_obj");

        const subItems = [
            { id: "sub1", name: "Alpha" },
            { id: "sub2", name: "Beta" }
        ];
        obj.set_items(subItems);

        expect(mockClient.update).toHaveBeenCalledWith("/app/mitems/chnl", {
            insert: [{ id: "my_obj", state: subItems }],
            reset: false
        });
    });

    test("receives collection state updates and notifies callbacks", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");
        const obj = new ProxyObject(coll, "my_obj");

        const callback = vi.fn();
        obj.add_callback(callback);

        const subItems = [{ id: "sub1", val: 100 }];

        // Simulate server update for my_obj
        coll._ssclient_update({
            insert: [{ id: "my_obj", state: subItems }]
        });

        expect(obj.get_items()).toEqual(subItems);
        expect(obj.has_item("sub1")).toBe(true);
        expect(obj.get_item("sub1")).toEqual({ id: "sub1", val: 100 });
        expect(callback).toHaveBeenCalledWith({
            id: "my_obj",
            new: { id: "my_obj", state: subItems },
            old: undefined
        });

        // Simulate update for unrelated item id
        callback.mockClear();
        coll._ssclient_update({
            insert: [{ id: "other_obj", state: [] }]
        });
        expect(callback).not.toHaveBeenCalled();
    });

    test("set_items throws error if items is not array", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/app/mitems/chnl");
        const obj = new ProxyObject(coll, "my_obj");

        expect(() => obj.set_items("not an array")).toThrow("items must be an array");
    });
});
