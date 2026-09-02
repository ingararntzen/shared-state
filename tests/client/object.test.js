import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/provider.js";
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
        const client = {
            _providers: new Map(),
            _collections: new Map(),
            _variables: new Map(),
            _subscriptions: new Map(),
            _update: vi.fn().mockResolvedValue({ ok: true }),
            _get_collection(path) {
                const ref = this._collections.get(path);
                return ref ? ref.deref() || null : null;
            },
            _set_collection(path, coll) {
                this._collections.set(path, new WeakRef(coll));
            },
            _get_variable(path, name) {
                const varMap = this._variables.get(path);
                if (varMap) {
                    const ref = varMap.get(name);
                    return ref ? ref.deref() || null : null;
                }
                return null;
            },
            _set_variable(path, name, variable) {
                let varMap = this._variables.get(path);
                if (!varMap) {
                    varMap = new Map();
                    this._variables.set(path, varMap);
                }
                varMap.set(name, new WeakRef(variable));
            },
            provider(collPath) {
                if (!this._providers.has(collPath)) {
                    this._providers.set(collPath, new ProxyCollection(this, collPath));
                }
                return this._providers.get(collPath);
            }
        };
        return client;
    }

    test("Variable defaultValues and initialValues", () => {
        const mockClient = createMockClient();

        const v = new Variable(mockClient, "/app/store/vars", "v1");
        const b = new SharedBool(mockClient, "/app/store/vars", "b1");
        const i = new SharedInteger(mockClient, "/app/store/vars", "i1");
        const f = new SharedFloat(mockClient, "/app/store/vars", "f1");
        const s = new SharedString(mockClient, "/app/store/vars", "s1");
        const o = new SharedObject(mockClient, "/app/store/vars", "o1");
        const a = new SharedArray(mockClient, "/app/store/vars", "a1");

        // Verify default values
        expect(v.value).toBeUndefined();
        expect(b.value).toBe(false);
        expect(i.value).toBe(0);
        expect(f.value).toBe(0.0);
        expect(s.value).toBe("");
        expect(o.value).toEqual({});
        expect(a.value).toEqual([]);

        // Verify initialValue options override defaultValue until valid server state arrives
        const bInit = new SharedBool(mockClient, "/app/store/vars", "bInit", { initialValue: true });
        const iInit = new SharedInteger(mockClient, "/app/store/vars", "iInit", { initialValue: 42 });

        expect(bInit.value).toBe(true);
        expect(iInit.value).toBe(42);

        // Server sends valid state for iInit
        const coll = mockClient.provider("/app/store/vars");
        coll._client_update({
            insert: [{ id: "iInit", state: 99 }]
        });

        expect(iInit.value).toBe(99);
    });

    test("SharedInteger operations and eventify notifications", async () => {
        const mockClient = createMockClient();
        const num = new SharedInteger(mockClient, "/app/store/vars2", "score");
        const coll = mockClient.provider("/app/store/vars2");

        expect(num.provider).toBe(coll);
        expect(num.value).toBe(0);

        const changeHandler = vi.fn();
        num.on("change", changeHandler);

        // Simulate server update for score
        coll._client_update({
            insert: [{ id: "score", state: 42 }]
        });

        expect(num.value).toBe(42);

        // Test inc / dec / set
        await num.inc(5);
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/vars2", {
            insert: [{ id: "score", state: 47 }],
            remove: [],
            reset: false
        });

        await num.set(100);
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/vars2", {
            insert: [{ id: "score", state: 100 }],
            remove: [],
            reset: false
        });
    });

    test("SharedString, SharedFloat, SharedObject, and SharedArray", () => {
        const mockClient = createMockClient();
        const str = new SharedString(mockClient, "/app/store/types", "status");
        const flt = new SharedFloat(mockClient, "/app/store/types", "temp");
        const obj = new SharedObject(mockClient, "/app/store/types", "settings");
        const arr = new SharedArray(mockClient, "/app/store/types", "tags");
        const coll = mockClient.provider("/app/store/types");

        coll._client_update({
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

        const setObj = new SharedSet(mockClient, "/app/store/members");

        await setObj.add("alice");
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/members", {
            insert: [{ id: '"alice"', state: "alice" }],
            remove: [],
            reset: false
        });

        // Test object hashing and equality
        const setObj2 = new SharedSet(mockClient, "/app/store/members2");
        await setObj2.add({ b: 2, a: 1 });
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/members2", {
            insert: [{ id: '{"a":1,"b":2}', state: { b: 2, a: 1 } }],
            remove: [],
            reset: false
        });

        // Test custom key option
        const customSet = new SharedSet(mockClient, "/app/store/custom", { key: (item) => item.sku });

        await customSet.add({ sku: "PROD-123", name: "Widget" });
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/custom", {
            insert: [{ id: "PROD-123", state: { sku: "PROD-123", name: "Widget" } }],
            remove: [],
            reset: false
        });

        const mapObj = new SharedMap(mockClient, "/app/store/config");

        await mapObj.set("theme", "dark");
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/config", {
            insert: [{ id: "theme", state: "dark" }],
            remove: [],
            reset: false
        });
    });

    test("Direct Layer 2 Instantiation and WeakRef Object Identity & Conflicts", () => {
        const mockClient = createMockClient();

        const intA = new SharedInteger(mockClient, "/app/mitems/res", "counter");
        const intB = new SharedInteger(mockClient, "/app/mitems/res", "counter");

        expect(intA).toBeDefined();
        expect(intA).toBe(intB); // WeakRef identity: intA === intB
        expect(intA.get()).toBe(0); // get() alias matches .value
        expect(intA.path).toBe("/app/mitems/res/counter");

        const mapA = new SharedMap(mockClient, "/app/mitems/settings");
        const mapB = new SharedMap(mockClient, "/app/mitems/settings");

        expect(mapA).toBeDefined();
        expect(mapA).toBe(mapB); // WeakRef identity: mapA === mapB
        expect(mapA.path).toBe("/app/mitems/settings");

        // Conflict check: Attempting to create a Variable on a path reserved for Collection
        expect(() => new SharedInteger(mockClient, "/app/mitems/settings", "counter"))
            .toThrow("Conflict: Cannot register Variable at '/app/mitems/settings'. Path is already reserved for Collection.");

        // Conflict check: Attempting to create a Collection on a path reserved for Variable
        expect(() => new SharedMap(mockClient, "/app/mitems/res"))
            .toThrow("Conflict: Cannot register Collection at '/app/mitems/res'. Path is already reserved for Variables.");
    });
});
