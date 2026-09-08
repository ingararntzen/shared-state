import { BaseAbstraction } from "./base_abstraction.js";

/**
 * Base class for all SharedState collection types (SharedMap and SharedSet).
 * Extends {@link BaseAbstraction} with collection mutation and change broadcasting.
 * @class BaseCollection
 */
export class BaseCollection extends BaseAbstraction {
    /**
     * Initializes a BaseCollection instance.
     * @param {SharedStateClient} client - The SharedState client instance
     * @param {string} path - Target path prefix for the collection
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, options = {}) {
        super(client, path, options);

        this.provider.add_callback((changes) => {
            this._on_provider_update(changes);
        });
    }

    /**
     * Removes all elements from the collection.
     * @returns {Promise<void>} Resolves when clear operation completes
     */
    async clear() {
        return await this._provider.update_items({ reset: true });
    }

    _on_provider_update(changes) {
        this.emit("change", changes);
    }

    get_state(name) {
        if (name === "change") {
            const items = this._provider.get_items();
            const insert = new Map(items.map((item) => [item.id, item]));
            return { remove: new Set(), insert, reset: true };
        }
        return null;
    }
}
