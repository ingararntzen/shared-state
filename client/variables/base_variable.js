import { BaseAbstraction } from "../base_abstraction.js";

export class BaseVariable extends BaseAbstraction {
    constructor(client, path, name, options = {}) {
        if (typeof name !== "string" || name === "") {
            throw new Error("Variable constructor expects a mandatory non-empty 'name' string.");
        }
        super(client, path, options);

        this._itemId = name;
        this._value = undefined;
        this._path = this._normPath + "/" + name;

        this.provider.add_callback((changes) => {
            this._on_provider_update(changes);
        });
    }

    get name() { return this._itemId; }
    get path() { return this._path; }
    get() { return this._value; }
    get value() { return this._value; }

    get_state(name) {
        if (name === "change") {
            return this.get();
        }
        return null;
    }

    _on_provider_update(changes) {
        const { remove, insert, reset } = changes;
        if (reset || remove.has(this._itemId) || insert.has(this._itemId)) {
            const lastValue = this._value;
            this._refresh_value();
            if (this._value !== lastValue) {
                this.emit("change", this._value);
            }
        }
    }

    _refresh_value() {
        const item = this._provider.get_item(this._itemId);
        this._value = item ? item.state : undefined;
    }
}
