import { describe, test, expect, vi } from "vitest";
import { ProxyCollection } from "../../client/provider.js";
import {
    SharedVariable,
    SharedTypedVariable,
    BaseTypedVariable,
    VariableType,
    SharedBool,
    SharedInteger,
    SharedFloat,
    SharedString,
    SharedObject,
    SharedArray
} from "../../client/objects/variables.js";
import { SharedSet } from "../../client/objects/set.js";
import { SharedMap } from "../../client/objects/map.js";

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

    test("SharedVariable and SharedTypedVariable defaultValues, allowUndefined, and initialValues", () => {
        const mockClient = createMockClient();

        const v = new SharedVariable(mockClient, "/app/store/vars", "v1");
        const b = new SharedBool(mockClient, "/app/store/vars", "b1", { allowUndefined: false });
        const i = new SharedInteger(mockClient, "/app/store/vars", "i1", { allowUndefined: false });
        const f = new SharedFloat(mockClient, "/app/store/vars", "f1", { allowUndefined: false });
        const s = new SharedString(mockClient, "/app/store/vars", "s1", { allowUndefined: false });
        const o = new SharedObject(mockClient, "/app/store/vars", "o1", { allowUndefined: false });
        const a = new SharedArray(mockClient, "/app/store/vars", "a1", { allowUndefined: false });

        // Verify untyped variable value is undefined
        expect(v.value).toBeUndefined();

        // Verify default values when allowUndefined: false
        expect(b.value).toBe(false);
        expect(i.value).toBe(0);
        expect(f.value).toBe(0.0);
        expect(s.value).toBe("");
        expect(o.value).toEqual({});
        expect(a.value).toEqual([]);

        // Verify custom defaultValue option overrides static type default (e.g. 100 instead of 0)
        const iCustomDef = new SharedInteger(mockClient, "/app/store/vars", "iCustomDef", { allowUndefined: false, defaultValue: 100 });
        expect(iCustomDef.value).toBe(100);

        // Verify direct SharedTypedVariable instantiation with VariableType enum
        const customTyped = new SharedTypedVariable(mockClient, "/app/store/vars", "cTyped", VariableType.INTEGER, { allowUndefined: false, defaultValue: 250 });
        expect(customTyped.type).toBe(VariableType.INTEGER);
        expect(customTyped.value).toBe(250);

        // Verify default allowUndefined: true returns undefined when no item or initialValue is present
        const bUndef = new SharedBool(mockClient, "/app/store/vars", "bUndef");
        expect(bUndef.value).toBeUndefined();

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
        const num = new SharedInteger(mockClient, "/app/store/vars2", "score", { allowUndefined: false });
        const coll = mockClient.provider("/app/store/vars2");

        expect(num.provider).toBe(coll);
        expect(num.value).toBe(0);

        const changeHandler = vi.fn();
        num.on("change", changeHandler);

        // Update server item state
        coll._client_update({
            insert: [{ id: "score", state: 10 }]
        });
        await Promise.resolve();

        expect(num.value).toBe(10);
        expect(changeHandler).toHaveBeenCalledWith(10, expect.anything());

        // Test inc and dec
        await num.inc(5);
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/vars2", {
            insert: [{ id: "score", state: 15 }],
            remove: [],
            reset: false
        });

        await num.dec(3);
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/vars2", {
            insert: [{ id: "score", state: 7 }],
            remove: [],
            reset: false
        });
    });

    test("SharedString, SharedFloat, SharedObject, and SharedArray", async () => {
        const mockClient = createMockClient();

        const str = new SharedString(mockClient, "/app/store/props", "title");
        const flt = new SharedFloat(mockClient, "/app/store/props", "ratio");
        const obj = new SharedObject(mockClient, "/app/store/props", "config");
        const arr = new SharedArray(mockClient, "/app/store/props", "tags");

        await str.set("Hello World");
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/props", {
            insert: [{ id: "title", state: "Hello World" }],
            remove: [],
            reset: false
        });

        await flt.set(3.14);
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/props", {
            insert: [{ id: "ratio", state: 3.14 }],
            remove: [],
            reset: false
        });

        await obj.set({ theme: "dark" });
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/props", {
            insert: [{ id: "config", state: { theme: "dark" } }],
            remove: [],
            reset: false
        });

        await arr.set(["a", "b"]);
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/props", {
            insert: [{ id: "tags", state: ["a", "b"] }],
            remove: [],
            reset: false
        });
    });

    test("SharedTypedVariable set() type validation and allowUndefined enforcement", async () => {
        const mockClient = createMockClient();

        const num = new SharedInteger(mockClient, "/app/store/vars3", "score", { allowUndefined: false });
        const str = new SharedString(mockClient, "/app/store/vars3", "name");

        // Invalid type throws TypeError
        expect(() => num.set("not_a_number")).toThrow(TypeError);
        expect(() => str.set(12345)).toThrow(TypeError);

        // Setting undefined when allowUndefined: false throws TypeError
        expect(() => num.set(undefined)).toThrow("Cannot set value of 'score' to undefined when allowUndefined is false.");

        // Valid type or string integer representation passes validation
        await num.set("42");
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/vars3", {
            insert: [{ id: "score", state: 42 }],
            remove: [],
            reset: false
        });
    });

    test("SharedSet and SharedMap iteration methods", async () => {
        const mockClient = createMockClient();

        const setObj = new SharedSet(mockClient, "/app/store/members");
        const mapObj = new SharedMap(mockClient, "/app/store/dict");

        await setObj.add("alice");
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/members", {
            insert: [{ id: '"alice"', state: "alice" }],
            remove: [],
            reset: false
        });

        await mapObj.set("key1", "val1");
        expect(mockClient._update).toHaveBeenCalledWith("/app/store/dict", {
            insert: [{ id: "key1", state: "val1" }],
            remove: [],
            reset: false
        });

        // Provider data update for mapObj and setObj
        const mapProvider = mockClient.provider("/app/store/dict");
        mapProvider._client_update({
            insert: [
                { id: "k1", state: "v1" },
                { id: "k2", state: "v2" }
            ]
        });

        const setProvider = mockClient.provider("/app/store/members");
        setProvider._client_update({
            insert: [
                { id: '"user1"', state: "user1" },
                { id: '"user2"', state: "user2" }
            ]
        });

        // Test SharedMap iteration methods
        expect(mapObj.keys()).toEqual(["k1", "k2"]);
        expect(mapObj.values()).toEqual(["v1", "v2"]);
        expect(mapObj.entries()).toEqual([["k1", "v1"], ["k2", "v2"]]);
        expect([...mapObj]).toEqual([["k1", "v1"], ["k2", "v2"]]);

        const mapEntries = [];
        mapObj.forEach((val, key) => mapEntries.push([key, val]));
        expect(mapEntries).toEqual([["k1", "v1"], ["k2", "v2"]]);

        // Test SharedSet iteration methods
        expect(setObj.keys()).toEqual(["user1", "user2"]);
        expect(setObj.values()).toEqual(["user1", "user2"]);
        expect(setObj.entries()).toEqual([["user1", "user1"], ["user2", "user2"]]);
        expect([...setObj]).toEqual(["user1", "user2"]);

        const setValues = [];
        setObj.forEach(val => setValues.push(val));
        expect(setValues).toEqual(["user1", "user2"]);
    });

    test("Direct Layer 2 Instantiation and Property Access", () => {
        const mockClient = createMockClient();

        const intA = new SharedInteger(mockClient, "/app/mitems/res", "counter", { allowUndefined: false });
        expect(intA).toBeDefined();
        expect(intA.get()).toBe(0); // get() alias matches .value
        expect(intA.path).toBe("/app/mitems/res/counter");

        const mapA = new SharedMap(mockClient, "/app/mitems/settings");
        expect(mapA).toBeDefined();
        expect(mapA.path).toBe("/app/mitems/settings");
    });
});
