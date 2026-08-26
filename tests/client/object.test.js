import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/ss_collection.js";
import {
    Variable,
    SharedBool,
    SharedInteger,
    SharedFloat,
    SharedString,
    SharedObject,
    SharedArray
} from "../../client/variables/variables.js";
import { SharedSet } from "../../client/collections/set.js";
import { SharedMap } from "../../client/collections/map.js";

describe("Layer 2 Domain Abstractions Unit Tests", () => {
    function createMockClient() {
        return {
            update: vi.fn().mockResolvedValue({ ok: true })
        };
    }

    test("Variable defaultValues and initialValues", () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/resources/app/store/vars");

        const v = new Variable(coll, "v1");
        const b = new SharedBool(coll, "b1");
        const i = new SharedInteger(coll, "i1");
        const f = new SharedFloat(coll, "f1");
        const s = new SharedString(coll, "s1");
        const o = new SharedObject(coll, "o1");
        const a = new SharedArray(coll, "a1");

        // Verify default values
        expect(v.value).toBeUndefined();
        expect(b.value).toBe(false);
        expect(i.value).toBe(0);
        expect(f.value).toBe(0.0);
        expect(s.value).toBe("");
        expect(o.value).toEqual({});
        expect(a.value).toEqual([]);

        // Verify initialValue options override defaultValue until valid server state arrives
        const bInit = new SharedBool(coll, "bInit", { initialValue: true });
        const iInit = new SharedInteger(coll, "iInit", { initialValue: 42 });

        expect(bInit.value).toBe(true);
        expect(iInit.value).toBe(42);

        // Server sends valid state for iInit
        coll._ssclient_update({
            insert: [{ id: "iInit", state: 99 }]
        });

        expect(iInit.value).toBe(99);
    });

    test("SharedInteger operations and eventify notifications", async () => {
        const mockClient = createMockClient();
        const coll = new ProxyCollection(mockClient, "/resources/app/store/vars");
        const num = new SharedInteger(coll, "score");

        expect(num.provider).toBe(coll);
        expect(num.value).toBe(0);

        const changeHandler = vi.fn();
        num.on("change", changeHandler);

        // Simulate server update for score
        coll._ssclient_update({
            insert: [{ id: "score", state: 42 }]
        });

        expect(num.value).toBe(42);

        // Test inc / dec / set
        await num.inc(5);
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/vars", {
            insert: [{ id: "score", state: 47 }],
            remove: [],
            reset: false
        });

        await num.set(100);
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/vars", {
            insert: [{ id: "score", state: 100 }],
            remove: [],
            reset: false
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

    test("SharedSet and SharedMap", async () => {
        const mockClient = createMockClient();

        const setColl = new ProxyCollection(mockClient, "/resources/app/store/members");
        const setObj = new SharedSet(setColl);

        await setObj.add("alice");
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/members", {
            insert: [{ id: '"alice"', state: "alice" }],
            remove: [],
            reset: false
        });

        // Test object hashing and equality
        const setColl2 = new ProxyCollection(mockClient, "/resources/app/store/members2");
        const setObj2 = new SharedSet(setColl2);
        await setObj2.add({ b: 2, a: 1 });
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/members2", {
            insert: [{ id: '{"a":1,"b":2}', state: { b: 2, a: 1 } }],
            remove: [],
            reset: false
        });

        // Test custom key option
        const customSetColl = new ProxyCollection(mockClient, "/resources/app/store/custom");
        const customSet = new SharedSet(customSetColl, { key: (item) => item.sku });

        await customSet.add({ sku: "PROD-123", name: "Widget" });
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/custom", {
            insert: [{ id: "PROD-123", state: { sku: "PROD-123", name: "Widget" } }],
            remove: [],
            reset: false
        });

        const mapColl = new ProxyCollection(mockClient, "/resources/app/store/config");
        const mapObj = new SharedMap(mapColl);

        await mapObj.set("theme", "dark");
        expect(mockClient.update).toHaveBeenCalledWith("/resources/app/store/config", {
            insert: [{ id: "theme", state: "dark" }],
            remove: [],
            reset: false
        });
    });
});
