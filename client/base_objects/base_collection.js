import { BaseAbstraction } from "./base_abstraction.js";
import { validatePath } from "../common.js";

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
     * @param {string} [token] - Binding lock token (defaults to constructor name)
     */
    constructor(client, path, options = {}, token = undefined) {
        path = validatePath(path);
        const cached = BaseAbstraction.get_cached_instance(path);
        if (cached) {
            return cached;
        }

        const tok = token || (new.target && new.target.name) || "BaseCollection";
        super(client, tok, path, undefined, options);

        BaseAbstraction.cache_instance(path, undefined, this);

        this._reader.add_callback((changes) => {
            this._on_provider_update(changes);
        });
    }

    /**
     * Removes all elements from the collection.
     * @returns {Promise<void>} Resolves when clear operation completes
     */
    async clear() {
        return await this._updater.clear();
    }

    _on_provider_update(changes) {
        this.emit("change", changes);
    }

    get_state(name) {
        if (name === "change") {
            const items = this._reader.get_items();
            const insert = new Map(items.map((item) => [item.id, item]));
            return { remove: new Set(), insert, reset: true };
        }
        return null;
    }
}
