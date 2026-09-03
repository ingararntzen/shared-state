import { SharedVariable } from "./shared_variable.js";

/**
 * Base class for typed shared variables.
 * Adds options for allowUndefined, initialValue fallback, and _validate type-checking.
 */
export class TypedVariable extends SharedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, options);

        this._allowUndefined = options.allowUndefined !== undefined ? Boolean(options.allowUndefined) : true;
        this._initialValue = options.initialValue !== undefined ? options.initialValue : options.initial;
        this._hasValidValue = false;

        // Perform initial value computation
        this._refresh_value();
    }

    /**
     * Typed subclasses override this getter (e.g., 0, "", false, {}, [])
     */
    get defaultValue() {
        return undefined;
    }

    /**
     * Subclasses override this method to validate/cast values.
     * Returns the validated typed value, or undefined if invalid.
     */
    _validate(val) {
        return val;
    }

    _refresh_value() {
        this._lastValue = this._value;

        // 1. Fetch raw item state from provider
        const item = this._provider.get_item(this._itemId);
        const itemVal = item ? item.state : undefined;

        // 2. If provider holds a value, validate it
        if (itemVal !== undefined) {
            const valid = this._validate(itemVal);
            if (valid !== undefined) {
                this._hasValidValue = true;
                this._value = valid;
                return;
            }
        }

        // 3. Before receiving a valid value from provider, check initialValue option
        if (!this._hasValidValue && this._initialValue !== undefined) {
            const validInitial = this._validate(this._initialValue);
            if (validInitial !== undefined) {
                this._value = validInitial;
                return;
            }
        }

        // 4. If undefined is explicitly allowed and provider value is undefined
        if (this._allowUndefined && itemVal === undefined) {
            this._value = undefined;
            return;
        }

        // 5. Fallback to typed defaultValue
        this._value = this.defaultValue;
    }
}
