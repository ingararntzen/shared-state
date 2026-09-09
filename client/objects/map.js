import { BaseCollection } from "../base_objects/base_collection.js";

/**
 * Replicated map data structure mimicking the standard JavaScript `Map` interface.
 * Extends {@link BaseCollection}.
 * @class SharedMap
 */
export class SharedMap extends BaseCollection {
    /**
     * Initializes a SharedMap instance.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Target path prefix for the map
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, options = {}) {
        super(client, path, options, "SharedMap");
    }

    /**
     * Sets a key-value pair in the map across the network.
     * @param {string} key - Map key
     * @param {*} value - Value to associate with key
     * @returns {Promise<void>} Resolves when update is processed
     */
    async set(key, value) {
        const record = { id: key, state: value };
        return await this._updater.update_items({ insert: [record] });
    }

    /**
     * Removes an entry specified by key from the map.
     * @param {string} key - Key to delete
     * @returns {Promise<void>} Resolves when update is processed
     */
    async delete(key) {
        return await this._updater.update_items({ remove: [key] });
    }

    /**
     * Removes all key-value entries from the map.
     * @returns {Promise<void>} Resolves when map is reset
     */
    async clear() {
        return await this._updater.clear();
    }

    /**
     * Retrieves the value associated with a key.
     * @param {string} key - Key to look up
     * @returns {*} Associated value, or `undefined` if key does not exist
     */
    get(key) {
        const item = this._reader.get_item(key);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    /**
     * Checks whether a key exists in the map.
     * @param {string} key - Key to check
     * @returns {boolean} `true` if key exists, `false` otherwise
     */
    has(key) {
        return this._reader.has_item(key);
    }

    /**
     * Returns an array of keys present in the map.
     * @returns {string[]} Array of keys
     */
    keys() {
        return this._reader.get_items().map(item => item.id);
    }

    /**
     * Returns an array of values present in the map.
     * @returns {Array<*>} Array of values
     */
    values() {
        return this._reader.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        );
    }

    /**
     * Returns an array of `[key, value]` pairs present in the map.
     * @returns {Array<Array>} Array of [key, value] pairs
     */
    entries() {
        return this._reader.get_items().map(item => [
            item.id,
            item.state !== undefined ? item.state : item.value
        ]);
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
     * @returns {Iterator} Iterator for map entries
     */
    [Symbol.iterator]() {
        return this.entries()[Symbol.iterator]();
    }
}
