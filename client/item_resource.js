/**
 * Class representing an item-exclusive state resource bound to a single itemID within a PathResource.
 * Returned by `client.get_item_resource(token, path, itemID)`.
 * @class ItemResource
 */
export class ItemResource {
    /**
     * @param {Object} provider - Parent PathResource (ItemProvider or OptimisticItemProvider)
     * @param {string} itemID - Target item identifier
     */
    constructor(provider, itemID) {
        this._provider = provider;
        this._itemID = itemID;
    }

    /**
     * The full canonical path of the underlying state provider.
     * @type {string}
     * @readonly
     */
    get path() {
        return this._provider.path;
    }

    /**
     * Target item identifier.
     * @type {string}
     * @readonly
     */
    get itemID() {
        return this._itemID;
    }

    /**
     * Alias for itemID.
     * @type {string}
     * @readonly
     */
    get itemId() {
        return this._itemID;
    }

    /**
     * Underlying PathResource (Layer 1 state provider).
     * @type {Object}
     * @readonly
     */
    get provider() {
        return this._provider;
    }

    /**
     * Retrieves the current state/value of the item.
     * @returns {*} Associated item state, or `undefined` if item does not exist
     */
    get() {
        const item = this._provider.get_item(this._itemID);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    /**
     * Checks whether the item exists in provider state.
     * @returns {boolean} `true` if item exists, `false` otherwise
     */
    item_exists() {
        return this._provider.has_item(this._itemID);
    }

    /**
     * Updates the item value across the network.
     * @param {*} value - New item state value
     * @param {Object} [options] - Update options
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    set(value, options = {}) {
        return this._provider.update_items({
            insert: [{ id: this._itemID, state: value }]
        }, options);
    }

    /**
     * Removes the item from the provider state across the network.
     * @param {Object} [options] - Update options
     * @returns {Promise<Object>} Resolves when delete update is dispatched/processed
     */
    delete(options = {}) {
        return this._provider.update_items({
            remove: [this._itemID]
        }, options);
    }

    /**
     * Registers a callback invoked whenever this specific item is inserted, removed, or reset.
     * @param {Function} handler - Callback receiving changes payload
     * @returns {Object} Subscription handle with `.off()` method
     */
    add_callback(handler) {
        const wrappedHandler = (changes) => {
            const { insert, remove, reset } = changes;
            const itemTouched = reset ||
                (remove && remove.has(this._itemID)) ||
                (insert && insert.has(this._itemID));

            if (itemTouched) {
                handler(changes);
            }
        };
        const handle = this._provider.add_callback(wrappedHandler);
        return {
            handle,
            off: () => this._provider.remove_callback(handle)
        };
    }

    /**
     * Removes a registered callback.
     * @param {Object} handle - Subscription handle returned from add_callback
     */
    remove_callback(handle) {
        const targetHandle = handle && handle.handle ? handle.handle : handle;
        this._provider.remove_callback(targetHandle);
    }
}
