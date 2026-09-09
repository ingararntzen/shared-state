/**
 * Interface representing a path-exclusive resource.
 * Implemented by ItemProvider and OptimisticItemProvider.
 * Returned by `client.get_resource(token, path)`.
 * @interface PathResource
 */
export class PathResource {
    /**
     * Resource path.
     * @type {string}
     * @readonly
     */
    get path() { }

    /**
     * Total number of items in the resource.
     * @type {number}
     * @readonly
     */
    get size() { }

    /**
     * Retrieves an item object by item identifier.
     * @param {string} id - Target item identifier
     * @returns {Object|undefined} Item object `{ id, state }`, or `undefined` if not present
     */
    get_item(id) { }

    /**
     * Retrieves all item objects within the resource.
     * @returns {Array<Object>} Array of item objects `{ id, state }`
     */
    get_items() { }

    /**
     * Checks if an item with given identifier exists within the resource.
     * @param {string} id - Target item identifier
     * @returns {boolean} `true` if item exists, `false` otherwise
     */
    has_item(id) { }

    /**
     * Request an update of items in this resource.
     * @param {Object} [changes={}] - Delta changes object `{ insert, remove, reset }`
     * @param {Object} [options={}] - Update options
     * @param {Boolean} [options.conditional=false] - If true, a conditional update will be performed
     * @returns {Promise<Object>} Resolves when update request is acknowledged from the server
     */
    update_items(changes = {}, options = {}) { }

    /**
     * Registers a callback invoked whenever items are added, removed, or updated in the resource.
     * @param {Function} handler(changes) - Callback function receiving change events
     * @returns {Object} Subscription handle to use with `.remove_callback()` method
     */
    add_callback(handler) { }

    /**
     * Removes a registered callback.
     * @param {Object} handle - Subscription handle returned from `add_callback`
     */
    remove_callback(handle) { }
}
