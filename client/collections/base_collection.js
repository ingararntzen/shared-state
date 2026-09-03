import { BaseAbstraction } from "../base_abstraction.js";

export class BaseCollection extends BaseAbstraction {
    constructor(client, path, options = {}) {
        super(client, path, options);
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
