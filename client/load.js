import { validatePath } from "./common.js";
import { SharedMap } from "./objects/map.js";
import { SharedSet } from "./objects/set.js";
import {
    SharedBool,
    SharedString,
    SharedInteger,
    SharedFloat,
    SharedObject,
    SharedArray,
    SharedVariable
} from "./objects/variables.js";

/**
 * Registry mapping abstraction names to their implementation constructors.
 */
export const TYPE_REGISTRY = {
    Map: SharedMap,
    Set: SharedSet,
    Bool: SharedBool,
    String: SharedString,
    Integer: SharedInteger,
    Float: SharedFloat,
    Object: SharedObject,
    Array: SharedArray,
    Variable: SharedVariable
};

/**
 * Standalone factory helper to configure and load Layer 2 abstraction objects.
 * @param {Object} client - SharedStateClient instance
 * @param {Object<string, {type: string, path: string, name?: string, options?: Object, optimistic?: boolean}>} config
 * @returns {Object<string, *>} Map of bound abstraction instances
 */
export function load(client, config) {
    if (!client || typeof client.provider !== "function") {
        throw new Error("load() expects a SharedStateClient instance as first argument.");
    }
    if (!config || typeof config !== "object") {
        throw new Error("load() expects a configuration object as second argument.");
    }

    const newObjects = {};
    const itemsToInstantiate = [];

    for (const [name, def] of Object.entries(config)) {
        if (!def || typeof def !== "object") {
            throw new Error(`Invalid configuration for '${name}'. Expected object format: { type: "...", path: "..." }`);
        }

        const typeName = def.type;
        const rawPath = def.path;
        const options = def.options || {};
        if (def.optimistic !== undefined) {
            options.optimistic = def.optimistic;
        }

        if (!typeName || !TYPE_REGISTRY[typeName]) {
            throw new Error(`Unknown or missing type '${typeName}' for '${name}'. Supported types: ${Object.keys(TYPE_REGISTRY).join(", ")}`);
        }

        const normPath = validatePath(rawPath);
        const ClassCtor = TYPE_REGISTRY[typeName];

        const isVariable = [
            SharedBool,
            SharedString,
            SharedInteger,
            SharedFloat,
            SharedObject,
            SharedArray,
            SharedVariable
        ].some(ctor => ClassCtor === ctor || ClassCtor.prototype instanceof SharedVariable);

        if (isVariable) {
            const varName = def.name || name;
            itemsToInstantiate.push({ name, ClassCtor, path: normPath, varName, isVariable: true, options });
        } else {
            itemsToInstantiate.push({ name, ClassCtor, path: normPath, isVariable: false, options });
        }
    }

    for (const item of itemsToInstantiate) {
        let obj;
        if (item.isVariable) {
            obj = new item.ClassCtor(client, item.path, item.varName, item.options);
        } else {
            obj = new item.ClassCtor(client, item.path, item.options);
        }
        if (client._app_objects) {
            client._app_objects[item.name] = obj;
        }
        newObjects[item.name] = obj;
    }

    return newObjects;
}
