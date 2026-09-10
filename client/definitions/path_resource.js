/**
 * Interface representing a path-exclusive resource.
 * @interface PathResource
 */
export class PathResource {
    /**
     * Underlying state provider instance.
     * @type {Object}
     * @readonly
     */
    get provider() { }

    /**
     * Total number of items in the resource.
     * @type {number}
     * @readonly
     */
    get size() { }

    /**
     * Retrieves an item state object by ID.
     * @param {string} id - Target item identifier
     * @returns {Item|undefined} Item state object `{ id, state }`, or `undefined` if not present
     */
    get_item(id) { }

    /**
     * Retrieves all item state objects within the resource.
     * @returns {Array<Item>} Array of item state objects `{ id, state }`
     */
    get_items() { }

    /**
     * Checks if an item exists within the resource.
     * @param {string} id - Target item identifier
     * @returns {boolean} `true` if item exists, `false` otherwise
     */
    has_item(id) { }

    /**
     * Updates items stored in the path resource across the network.
     * @param {Changes} [changes] - Delta changes object `{ insert, remove, reset }`
     * @param {Object} [options] - Update options
     * @param {boolean} [options.conditional=false] - If true, a conditional update will be performed
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    update_items(changes = {}, options = {}) { }

    /**
     * Registers a callback invoked whenever state changes on this path.
     * @param {Function} handler - Callback function receiving change events
     * @returns {Object} Subscription handle object with `.off()` or `.remove()` method
     */
    add_callback(handler) { }

    /**
     * Removes a registered callback.
     * @param {Object} handle - Subscription handle returned from `add_callback`
     */
    remove_callback(handle) { }
}
