/**
 * Interface representing a resource bound to a single Item within a PathResource.
 * @interface ItemResource
 */
export class ItemResource {
    /**
     * Resource name.
     * @type {string}
     * @readonly
     */
    get name() { }

    /**
     * Source ItemProvider.
     * @type {Object}
     * @readonly
     */
    get provider() { }

    /**
     * Retrieves the current value of the resource.
     * @returns {*} Resource value, or `undefined` if item is uninitialized
     */
    get() { }

    /**
     * Checks whether the item has been initialized in provider state.
     * @returns {boolean} `true` if item is initialized, `false` otherwise
     */
    is_initialized() { }

    /**
     * Updates the value of the resource.
     * @param {*} value - New value
     * @param {Object} [options] - Update options
     * @returns {Promise<Object>} Resolves when update request is acknowledged by the server.
     */
    set(value, options = {}) { }

    /**
     * Registers a callback invoked whenever the value of the resource is changed.
     * @param {Function} handler - Callback receiving changes payload
     * @returns {Object} Subscription handle with `.remove_callback()` method
     */
    add_callback(handler) { }

    /**
     * Removes a registered callback.
     * @param {Object} handle - Subscription handle returned from add_callback
     */
    remove_callback(handle) { }
}
