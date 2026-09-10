/**
 * Concrete provider representing a single item bound within a PathResource.
 * Implements ItemResource.
 * @class SingleItemProvider
 */
export class SingleItemProvider {
    /**
     * @param {Object} provider - Parent PathResource (ItemProvider or OptimisticItemProvider)
     * @param {string} name - Target item identifier/name
     */
    constructor(provider, name) {
        this._provider = provider;
        this._name = name;
    }

    /**
     * Target item identifier name.
     * @type {string}
     * @readonly
     */
    get name() {
        return this._name;
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
     * @returns {*} Associated item state, or `undefined` if item is uninitialized
     */
    get() {
        const item = this._provider.get_item(this._name);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    /**
     * Checks whether the item has been initialized in provider state.
     * @returns {boolean} `true` if item is initialized, `false` otherwise
     */
    is_initialized() {
        return this._provider.has_item(this._name);
    }

    /**
     * Updates the item value across the network.
     * @param {*} value - New item state value
     * @param {Object} [options] - Update options
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    set(value, options = {}) {
        return this._provider.update_items({
            insert: [{ id: this._name, state: value }]
        }, options);
    }

    /**
     * Registers a callback invoked whenever this specific item is updated or reset.
     * @param {Function} handler - Callback receiving value change `{ new: *, old: * }`
     * @returns {Object} Subscription handle with `.remove_callback()` and `.off()` methods
     */
    add_callback(handler) {
        let oldValue = this.get();
        const wrappedHandler = (changes) => {
            const { insert, remove, reset } = changes;
            const itemTouched = reset ||
                (remove && remove.has(this._name)) ||
                (insert && insert.has(this._name));

            if (itemTouched) {
                const newValue = this.get();
                const diff = { new: newValue, old: oldValue };
                oldValue = newValue;
                handler(diff);
            }
        };
        const handle = this._provider.add_callback(wrappedHandler);
        return {
            handle,
            remove_callback: () => this._provider.remove_callback(handle),
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
