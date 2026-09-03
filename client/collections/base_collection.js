import { BaseAbstraction } from "../base_abstraction.js";
import { validatePath } from "../common.js";

export class BaseCollection extends BaseAbstraction {
    constructor(client, path, options = {}) {
        const normPath = validatePath(path);

        if (client && client._variables && client._variables.has(normPath)) {
            throw new Error(`Conflict: Cannot register Collection at '${path}'. Path is already reserved for Variables.`);
        }

        const cached = client && client._get_collection ? client._get_collection(normPath) : null;
        if (cached) {
            return cached;
        }

        super(client, path, options);

        if (client._set_collection) {
            client._set_collection(this._normPath, this);
        }
    }

    _on_provider_update(changes) {
        const formatted = this._formatChanges ? this._formatChanges(changes) : changes;
        this.emit("change", formatted);
    }

    get_state(name) {
        if (name === "change") {
            const items = this._provider.get_items();
            return { remove: [], insert: items, reset: true };
        }
        return null;
    }

    get size() {
        return this._provider.size;
    }

    get_items() {
        return this._provider.get_items();
    }
}
