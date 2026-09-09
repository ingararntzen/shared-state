/**
 * ItemReader provides a scoped read-only interface and event stream for a single item (variable) within an ItemProvider.
 * @class ItemReader
 */
export class ItemReader {
    /**
     * @param {ItemProvider|OptimisticItemProvider} provider - Target Layer 1 state provider
     * @param {string} itemId - Target item key/identifier
     */
    constructor(provider, itemId) {
        this._provider = provider;
        this._itemId = itemId;
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
    get itemId() {
        return this._itemId;
    }

    /**
     * Underlying Layer 1 state provider.
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
        const item = this._provider.get_item(this._itemId);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    /**
     * Checks whether the item exists in provider state.
     * @returns {boolean} `true` if item exists, `false` otherwise
     */
    item_exists() {
        return this._provider.has_item(this._itemId);
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
                (remove && remove.has(this._itemId)) ||
                (insert && insert.has(this._itemId));

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

/**
 * ItemUpdater provides isolated write access for a single item (variable) within an ItemProvider.
 * @class ItemUpdater
 */
export class ItemUpdater {
    /**
     * @param {ItemProvider|OptimisticItemProvider} provider - Target Layer 1 state provider
     * @param {string} itemId - Target item key/identifier
     */
    constructor(provider, itemId) {
        this._provider = provider;
        this._itemId = itemId;
    }

    /**
     * Target item identifier.
     * @type {string}
     * @readonly
     */
    get itemId() {
        return this._itemId;
    }

    /**
     * Updates the item value across the network.
     * @param {*} value - New item state value
     * @param {Object} [options] - Update options
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    set(value, options = {}) {
        return this._provider._update_items({
            insert: [{ id: this._itemId, state: value }]
        }, options);
    }
}
