/**
 * Interface representing a single-value resource bound to a specific item name within a CollectionResource.
 * @interface ValueResource
 */
export class ValueResource {
    /**
     * Item name identifier.
     * @type {string}
     * @readonly
     */
    get name() { }

    /**
     * Underlying CollectionResource (Layer 1 state provider).
     * @type {Object}
     * @readonly
     */
    get provider() { }

    /**
     * Retrieves the current state/value of the item.
     * @returns {*} Associated item state, or `undefined` if item is uninitialized
     */
    get() { }

    /**
     * Checks whether the item has been initialized in provider state.
     * @returns {boolean} `true` if item is initialized, `false` otherwise
     */
    is_initialized() { }

    /**
     * Updates the item value across the network.
     * @param {*} value - New item state value
     * @param {Object} [options] - Update options
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    set(value, options = {}) { }

    /**
     * Registers a callback invoked whenever this specific item is updated or reset.
     * @param {Function} handler - Callback receiving changes payload
     * @returns {Object} Subscription handle with `.off()` method
     */
    add_callback(handler) { }

    /**
     * Removes a registered callback.
     * @param {Object} handle - Subscription handle returned from add_callback
     */
    remove_callback(handle) { }
}
