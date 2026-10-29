/**
 * Interface to resource that represents a single value.
 * @interface ValueResource
 */
export class ValueResource {

    /**
     * Underlying state provider instance.
     * @type {Object}
     * @readonly
     */
    get provider() { }

    /**
     * Retrieves the current value of the resource.
     * @returns {*} Current value or `undefined` if resource is not initialized
     */
    get() { }

    /**
     * Checks whether the resource has been initialized.
     * @returns {boolean} `true` if resource is initialized, `false` otherwise
     */
    is_initialized() { }

    /**
     * Request an update to the value of the resource.
     * @param {*} value - New value
     * @param {Object} [options] - Update options
     * @param {boolean} [options.dropIfModified=false] - If true, server drops the update request if resource has been modified by other client in the mean time.
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    set(value, options = {}) { }

    /**
     * Registers a handler invoked whenever the resource value changes.
     * @param {Function} handler(diff) - Handler function receiving value diff `{ new: *, old: * }`
     * @returns {Object} Subscription handle with `.remove_handler()`
     */
    add_handler(handler) { }

    /**
     * Removes a registered handler.
     * @param {Object} handle - Subscription handle returned from add_handler
     */
    remove_handler(handle) { }
}
