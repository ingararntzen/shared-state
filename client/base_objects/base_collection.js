import { BaseAbstraction } from "./base_abstraction.js";

export class BaseCollection extends BaseAbstraction {
    constructor(client, path, options = {}) {
        super(client, path, options);

        this.provider.add_callback((changes) => {
            this._on_provider_update(changes);
        });
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
