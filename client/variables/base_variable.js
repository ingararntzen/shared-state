import { BaseAbstraction } from "../base_abstraction.js";



export class BaseVariable extends BaseAbstraction {
    constructor(client, path, name, options = {}) {

        if (typeof name !== "string" || name === "") {
            throw new Error("Variable constructor expects a mandatory non-empty 'name' string.");
        }
        super(client, path, options);

        // internal state
        this._itemId = name;
        this._value = undefined;

        this._initialValue = options?.initialValue;
        this._defaultValue = options?.defaultValue;

        // register callback on state changes in provider 
        this.provider.add_callback((changes) => {
            this._on_provider_update(changes);
        });

        // initialize
        this._refresh_value();
    }

    // public accessors
    get name() { return this._itemId; }

    // public interface
    get() { return this._value; };
    get value() { return this._value; };

    // eventify - initial state
    get_state(name) {
        if (name === "change") {
            return this.get();
        }
        return null;
    }

    // callback from provider
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

    // refresh _value when provider updates 
    _refresh_value() {
        const item = this._provider.get_item(this._itemId);
        if (item) {
            this._value = item.state;
        }
    }


}
