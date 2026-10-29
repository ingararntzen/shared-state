/**
 * Interface to resources that represent a collection of items.
 * @interface CollectionResource
 * @see {@link Item}
 * @see {@link Changes}
 */
export class CollectionResource {
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
     * Retrieves an item by ID.
     * @param {string} id - Target item identifier
     * @returns {Item|undefined} 
     */
    get_item(id) { }

    /**
     * Retrieves all items within the resource.
     * @returns {Item[]}
     */
    get_items() { }

    /**
     * Checks if an item exists within the resource.
     * @param {string} id - Target item identifier
     * @returns {boolean} `true` if item exists, `false` otherwise
     */
    has_item(id) { }

    /**
     * Request an update to items in the resource.
     * @param {Changes} changes - Requested {@link Changes}
     * @param {Object} [options] - Update options
     * @param {boolean} [options.dropIfModified=false] - If true, server drops the update request if resource has been modified by other client in the mean time.
     * @returns {Promise<Object>} Resolves when state update is acknowledged by the server
     */
    update_items(changes, options = {}) { }

    /**
     * Registers a handler invoked whenever the resource changes.
     * @param {Function} handler(changes) - Handler function receiving change event
     * @returns {Object} Subscription handle object with `.remove_handler()`.
     */
    add_handler(handler) { }

    /**
     * Removes a registered handler.
     * @param {Object} handle - Subscription handle returned from `add_handler`
     */
    remove_handler(handle) { }
}

