import { BaseCollection } from "../base_objects/base_collection.js";

export function canonicalStringify(val) {
    if (val === null || typeof val !== "object") {
        return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
        return "[" + val.map(canonicalStringify).join(",") + "]";
    }
    const keys = Object.keys(val).sort();
    const keyValPairs = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(val[k])}`);
    return "{" + keyValPairs.join(",") + "}";
}

/**
 * Callback function signature used to calculate a unique key for set elements.
 * @callback KeyFunction
 * @param {*} elem - Element added to or queried in the set
 * @returns {string|number} Unique key identifying the element
 */

/**
 * Online-hosted set data structure emulating the standard JavaScript `Set` interface.
 * Extends {@link BaseCollection}.
 * 
 * `SharedSet` implements the {@link Events} interface.
 * All state changes are emitted on the `"change"` event, with {@link Changes changes} as callback payload.
 * @class SharedSet
 */
export class SharedSet extends BaseCollection {
    /**
     * Initializes a SharedSet instance.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Resource [Path](/design/representation/item_collection#path)
     * @param {Object} [options] - Configuration options
     * @param {KeyFunction} [options.key] - Custom element identity key function receiving `elem` and returning a unique key
     */
    constructor(client, path, options = {}) {
        super(client, path, options, "SharedSet");
        this._keyFn = options.key || null;
    }

    _getId(elem) {
        if (this._keyFn) {
            return String(this._keyFn(elem));
        }
        if (elem !== null && typeof elem === "object" && elem.id !== undefined) {
            return String(elem.id);
        }
        return canonicalStringify(elem);
    }

    /**
     * Returns the number of elements in the set.
     * @type {number}
     * @readonly
     */
    get size() {
        return this._resource.size;
    }

    /**
     * Adds an element to the set across the network.
     * @param {*} elem - Element to add
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    async add(elem) {
        const id = this._getId(elem);
        const record = { id, state: elem };
        return await this._resource.update_items({ insert: [record] });
    }

    /**
     * Removes an element from the set.
     * @param {*} elem - Element to remove
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    async delete(elem) {
        const id = this._getId(elem);
        return await this._resource.update_items({ remove: [id] });
    }

    /**
     * Removes all elements from the set.
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    async clear() {
        return await this._resource.update_items({ reset: true });
    }

    /**
     * Checks whether an element exists in the set.
     * @param {*} elem - Element to check
     * @returns {boolean} `true` if element exists, `false` otherwise
     */
    has(elem) {
        const id = this._getId(elem);
        return this._resource.has_item(id);
    }

    /**
     * Returns an iterator over elements in the set (alias for `values()`).
     * @returns {Iterator<*>} Iterator for set values
     */
    keys() {
        return this.values();
    }

    /**
     * Returns an iterator over elements present in the set.
     * @returns {Iterator<*>} Iterator for set values
     */
    values() {
        return this._resource.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        )[Symbol.iterator]();
    }

    /**
     * Returns an iterator over `[value, value]` pairs present in the set.
     * @returns {Iterator<Array>} Iterator for value pairs
     */
    entries() {
        return this._resource.get_items().map(item => {
            const val = item.state !== undefined ? item.state : item.value;
            return [val, val];
        })[Symbol.iterator]();
    }

    /**
     * Executes a callback function once per element in the set.
     * @param {Function} callback - Function executing `(value, value, set)`
     * @param {*} [thisArg] - Value to use as `this` when executing callback
     */
    forEach(callback, thisArg) {
        for (const val of this.values()) {
            callback.call(thisArg, val, val, this);
        }
    }

    /**
     * Returns an iterator over set values.
     * @returns {Iterator<*>} Iterator for set values
     */
    [Symbol.iterator]() {
        return this.values();
    }
}
