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
 * Replicated set data structure mimicking the standard JavaScript `Set` interface.
 * Extends {@link BaseCollection}.
 * @class SharedSet
 */
export class SharedSet extends BaseCollection {
    /**
     * Initializes a SharedSet instance.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Target path prefix for the set
     * @param {Object} [options] - Configuration options
     * @param {Function} [options.key] - Custom element identity key function
     */
    constructor(client, path, options = {}) {
        super(client, path, options, "SharedSet");
        this._keyFn = options.key || options.get_id || null;
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
     * Adds an element to the set across the network.
     * @param {*} elem - Element to add
     * @returns {Promise<void>} Resolves when update is processed
     */
    async add(elem) {
        const id = this._getId(elem);
        const record = { id, state: elem };
        return await this._updater.update_items({ insert: [record] });
    }

    /**
     * Removes an element from the set.
     * @param {*} elem - Element to remove
     * @returns {Promise<void>} Resolves when update is processed
     */
    async delete(elem) {
        const id = this._getId(elem);
        return await this._updater.update_items({ remove: [id] });
    }

    /**
     * Removes all elements from the set.
     * @returns {Promise<void>} Resolves when set is reset
     */
    async clear() {
        return await this._updater.clear();
    }

    /**
     * Checks whether an element exists in the set.
     * @param {*} elem - Element to check
     * @returns {boolean} `true` if element exists, `false` otherwise
     */
    has(elem) {
        const id = this._getId(elem);
        return this._reader.has_item(id);
    }

    /**
     * Returns an array of elements in the set (alias for `values()`).
     * @returns {Array<*>} Array of set values
     */
    keys() {
        return this.values();
    }

    /**
     * Returns an array of elements present in the set.
     * @returns {Array<*>} Array of set values
     */
    values() {
        return this._reader.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        );
    }

    /**
     * Returns an array of `[value, value]` pairs present in the set.
     * @returns {Array<Array>} Array of value pairs
     */
    entries() {
        return this.values().map(val => [val, val]);
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
     * @returns {Iterator} Iterator for set values
     */
    [Symbol.iterator]() {
        return this.values()[Symbol.iterator]();
    }
}
