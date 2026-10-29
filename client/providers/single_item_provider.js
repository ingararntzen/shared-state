import { sanitizeChanges } from "../common.js";

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
     * Convenience method delegating to {@link update_items}.
     * @param {*} value - New item state value
     * @param {Object} [options={}] - Update options
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    async set(value, options = {}) {
        return this.update_items({
            insert: [{ id: this._name, state: value }]
        }, options);
    }

    /**
     * Requests an update to the item in the resource conforming to the universal provider contract.
     *
     * Note: In the context of SingleItemProvider, `update_items` is not intuitive because this
     * provider only represents and supports setting a single value for this item, rather than
     * batch updates across multiple items. It is provided to support a uniform interface across ItemProviders.
     *
     * Restrictions:
     * - `remove` and `reset` are not allowed and will throw an Error if defined.
     * - `insert` must contain exactly one item (either a Map of size 1 or an Array with 1 item).
     *   Passing more than one item, an empty collection, or omitting `insert` will throw an Error.
     *
     * @param {Object} changes - Changes object `{ insert }`.
     * @param {Map<string, Object>|Array<Object>} changes.insert - Map of size 1 or Array of length 1 containing the item update.
     * @param {Object} [options={}] - Update options (e.g. dropIfModified).
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed.
     * @throws {Error} If remove or reset is defined, or if insert does not contain exactly one item.
     */
    async update_items(changes = {}, options = {}) {
        if (changes?.remove !== undefined) {
            throw new Error("SingleItemProvider does not support 'remove'. Only setting a single item value is supported.");
        }
        if (changes?.reset !== undefined) {
            throw new Error("SingleItemProvider does not support 'reset'. Only setting a single item value is supported.");
        }

        const { insert } = sanitizeChanges(changes);
        if (insert.size === 0) {
            throw new Error("SingleItemProvider requires 'insert' containing exactly one item.");
        }
        if (insert.size > 1) {
            throw new Error("SingleItemProvider 'insert' cannot contain more than one item.");
        }

        const [item] = insert.values();
        return this._provider.update_items({
            insert: new Map([[this._name, { ...item, id: this._name }]])
        }, options);
    }

    /**
     * Registers a callback handler invoked whenever this specific item is updated or reset.
     * @param {Function} handler - Callback receiving value change `{ new: *, old: * }`
     * @returns {Object} Subscription handle with `.remove_handler()` and `.cancel()` methods
     */
    add_handler(handler) {
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
        const handle = this._provider.add_handler(wrappedHandler);
        return {
            handle,
            remove_handler: () => this._provider.remove_handler(handle),
            cancel: () => this._provider.remove_handler(handle)
        };
    }

    /**
     * Removes a registered handler.
     * @param {Object} handle - Subscription handle returned from add_handler
     */
    remove_handler(handle) {
        const targetHandle = handle && handle.handle ? handle.handle : handle;
        this._provider.remove_handler(targetHandle);
    }
}
