import { BaseCollection } from "../base_objects/base_collection.js";

/**
 * Online-hosted key-value store emulating the standard JavaScript `Map` interface.
 * Extends {@link BaseCollection}.
 * 
 * `SharedMap` implements the {@link Events} interface. 
 * All state changes are emitted on the `"change"` event, with {@link Changes changes} as callback payload.
 * @class SharedMap
 */
export class SharedMap extends BaseCollection {
    /**
     * Initializes a SharedMap instance.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Resource [Path](/design/representation/item_collection#path)
     */
    constructor(client, path) {
        super(client, path, {}, "SharedMap");
    }

    /**
     * Returns the number of key-value entries in the map.
     * @type {number}
     * @readonly
     */
    get size() {
        return this._resource.size;
    }

    /**
     * Sets a key-value pair.
     * @param {string} key - Key
     * @param {*} value - Value to associate with key
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    async set(key, value) {
        const record = { id: key, state: value };
        return await this._resource.update_items({ insert: [record] });
    }

    /**
     * Removes an entry specified by key from the map.
     * @param {string} key - Key to delete
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    async delete(key) {
        return await this._resource.update_items({ remove: [key] });
    }

    /**
     * Removes all key-value entries from the map.
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    async clear() {
        return await this._resource.update_items({ reset: true });
    }

    /**
     * Retrieves the value associated with a key.
     * @param {string} key - Key to look up
     * @returns {*} Associated value, or `undefined` if key does not exist
     */
    get(key) {
        const item = this._resource.get_item(key);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    /**
     * Checks whether a key exists in the map.
     * @param {string} key - Key to check
     * @returns {boolean} `true` if key exists, `false` otherwise
     */
    has(key) {
        return this._resource.has_item(key);
    }

    /**
     * Returns an iterator over keys present in the map.
     * @returns {Iterator<string>} Iterator for map keys
     */
    keys() {
        return this._resource.get_items().map(item => item.id)[Symbol.iterator]();
    }

    /**
     * Returns an iterator over values present in the map.
     * @returns {Iterator<*>} Iterator for map values
     */
    values() {
        return this._resource.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        )[Symbol.iterator]();
    }

    /**
     * Returns an iterator over `[key, value]` pairs present in the map.
     * @returns {Iterator<Array>} Iterator for [key, value] pairs
     */
    entries() {
        return this._resource.get_items().map(item => [
            item.id,
            item.state !== undefined ? item.state : item.value
        ])[Symbol.iterator]();
    }

    /**
     * Executes a callback function once per map entry.
     * @param {Function} callback - Function executing `(value, key, map)`
     * @param {*} [thisArg] - Value to use as `this` when executing callback
     */
    forEach(callback, thisArg) {
        for (const [key, val] of this.entries()) {
            callback.call(thisArg, val, key, this);
        }
    }

    /**
     * Returns an iterator over `[key, value]` entries.
     * @returns {Iterator<Array>} Iterator for map entries
     */
    [Symbol.iterator]() {
        return this.entries();
    }
}
