import { BaseVariable } from "./base_variable.js";

/**
 * Untyped shared variable abstraction.
 * Allows undefined as a legal value.
 */
export class SharedVariable extends BaseVariable {

    constructor(client, path, name, options = {}) {
        super(client, path, name, options);
        // Initialise
        this._refresh_value();
    }

    set(val) {
        return this.provider.update_items({
            insert: [{ id: this.name, state: val }]
        });
    }


    _refresh_value() {
        const item = this._provider.get_item(this._itemId);
        this._value = item ? item.state : undefined;
    }

}
