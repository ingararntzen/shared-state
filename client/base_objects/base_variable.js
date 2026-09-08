import { BaseAbstraction } from "./base_abstraction.js";

/**
 * Base class for all Layer 2 variables.
 */
export class BaseVariable extends BaseAbstraction {
    constructor(client, path, name, options = {}) {
        if (!name || typeof name !== "string") {
            throw new Error("Variable name must be a non-empty string");
        }
        super(client, path, options);

        this._itemId = name;
        this._value = undefined;
        this._path = this._normPath + "/" + name;

        // Register change callback on Layer 1 provider
        this.provider.add_callback((changes) => {
            this._on_provider_update(changes);
        });
    }

    // getters
    get name() { return this._itemId; }
    get value() { return this._value; }
    get path() { return this._path; }

    // public methods
    get() { return this.value; }

    set(val) {
        return this.provider.update_items({
            insert: [{ id: this.name, state: val }]
        });
    }

    // internal event handler
    _on_provider_update(changes) {
        const prev = this._value;
        this._refresh_value();
        if (this._value !== prev) {
            this.emit("change", this._value, prev);
        }
    }

    _refresh_value() {
        const item = this._provider.get_item(this._itemId);
        this._value = item ? item.state : undefined;
    }
}
