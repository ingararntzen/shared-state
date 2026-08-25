import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/ss_collection.js";
import {
    SharedInteger,
    SharedFloat,
    SharedString,
    SharedObject,
    SharedArray
} from "../../client/variables/variables.js";
import { SharedList } from "../../client/collections/list.js";
import { SharedSet } from "../../client/collections/set.js";
import { SharedMap } from "../../client/collections/map.js";

describe("Layer 2 Domain Abstractions Unit Tests", () => {
    function createMockClient() {
        return {
            update: vi.fn().mockResolvedValue({ ok: true })
        };
    }

    test("SharedInteger operations and eventify notifications", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/resources/app/store/vars");
        const num = new SharedInteger(coll, "score");

        expect(num.value).toBe(0);

        const changeHandler = vi.fn();
        num.on("change", changeHandler);

        // Simulate server update for score
        coll._ssclient_update({
            insert: [{ id: "score", state: 42 }]
        });

        expect(num.value).toBe(42);

        // Test inc / dec / set
        num.inc(5);
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/vars", {
            insert: [{ id: "score", state: 47 }]
        });

        num.set(100);
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/vars", {
            insert: [{ id: "score", state: 100 }]
        });
    });

    test("SharedString, SharedFloat, SharedObject, and SharedArray", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/resources/app/store/vars");
        const str = new SharedString(coll, "status");
        const flt = new SharedFloat(coll, "temp");
        const obj = new SharedObject(coll, "settings");
        const arr = new SharedArray(coll, "tags");

        coll._ssclient_update({
            insert: [
                { id: "status", state: "active" },
                { id: "temp", state: 98.6 },
                { id: "settings", state: { mode: "dark" } },
                { id: "tags", state: ["admin", "dev"] }
            ]
        });

        expect(str.value).toBe("active");
        expect(flt.value).toBe(98.6);
        expect(obj.value).toEqual({ mode: "dark" });
        expect(arr.value).toEqual(["admin", "dev"]);

        // Type restrictions
        expect(() => obj.set("not an object")).toThrow("SharedObject value must be an object ({})");
        expect(() => arr.set({ not: "an array" })).toThrow("SharedArray value must be an array ([])");
    });

    test("SharedList, SharedSet, and SharedMap", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/resources/app/store/chat");
        const list = new SharedList(coll);

        list.append({ id: "m1", text: "hello" });
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/chat", {
            insert: [{ id: "m1", text: "hello" }]
        });

        const setColl = new ProxyCollection(mockClient, "/resources/app/store/members");
        const setObj = new SharedSet(setColl);

        setObj.add("alice");
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/members", {
            insert: [{ id: "alice", state: "alice" }]
        });

        const mapColl = new ProxyCollection(mockClient, "/resources/app/store/config");
        const mapObj = new SharedMap(mapColl);

        mapObj.set("theme", "dark");
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/config", {
            insert: [{ id: "theme", state: "dark" }]
        });
    });
});
