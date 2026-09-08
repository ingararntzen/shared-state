import { BaseVariable } from "./base_variable.js";

/**
 * Enum for supported shared variable data types.
 */
export const VariableType = {
    BOOL: "BOOL",
    STRING: "STRING",
    INTEGER: "INTEGER",
    FLOAT: "FLOAT",
    OBJECT: "OBJECT",
    ARRAY: "ARRAY"
};

/**
 * Type-specific default values and validation rules.
 */
const TYPE_CONFIG = {
    [VariableType.BOOL]: {
        default: false,
        validate(val) {
            if (typeof val === "boolean") return val;
            if (val === "true") return true;
            if (val === "false") return false;
            return undefined;
        }
    },
    [VariableType.STRING]: {
        default: "",
        validate(val) {
            return typeof val === "string" ? val : undefined;
        }
    },
    [VariableType.INTEGER]: {
        default: 0,
        validate(val) {
            if (typeof val === "number" && Number.isInteger(val)) return val;
            if (typeof val === "string" && val.trim() !== "") {
                const parsed = parseInt(val, 10);
                if (!isNaN(parsed)) return parsed;
            }
            return undefined;
        }
    },
    [VariableType.FLOAT]: {
        default: 0.0,
        validate(val) {
            if (typeof val === "number" && !isNaN(val)) return val;
            if (typeof val === "string" && val.trim() !== "") {
                const parsed = parseFloat(val);
                if (!isNaN(parsed)) return parsed;
            }
            return undefined;
        }
    },
    [VariableType.OBJECT]: {
        default: {},
        validate(val) {
            if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                return val;
            }
            return undefined;
        }
    },
    [VariableType.ARRAY]: {
        default: [],
        validate(val) {
            return Array.isArray(val) ? val : undefined;
        }
    }
};

/**
 * Base class for typed shared variables.
 * Subclasses BaseVariable directly.
 */
export class BaseTypedVariable extends BaseVariable {
    constructor(client, path, name, type, options = {}) {
        if (!type || !TYPE_CONFIG[type]) {
            throw new Error(`Invalid type: ${type}. Supported types are ${Object.keys(TYPE_CONFIG).join(", ")}`);
        }
        super(client, path, name, options);

        // internal state
        this._type = type;
        this._typeConfig = TYPE_CONFIG[type];
        this._isInitialised = false;

        // options
        let {
            allowUndefined = true,
            defaultValue = this._typeConfig.default,
            initialValue
        } = options;

        this._allowUndefined = Boolean(allowUndefined);
        this._defaultValue = this._typeConfig.validate(defaultValue);
        this._initialValue = this._typeConfig.validate(initialValue);

        // Initialise
        this._refresh_value();
    }

    // accessors
    get type() { return this._type; }
    get defaultValue() { return this._defaultValue; }
    get initialValue() { return this._initialValue; }
    get allowUndefined() { return this._allowUndefined; }

    // public
    set(val) {
        if (val === undefined) {
            if (!this._allowUndefined) {
                throw new TypeError(`Cannot set value of '${this.name}' to undefined when allowUndefined is false.`);
            }
            return super.set(undefined);
        }

        const value = this._typeConfig.validate(val);
        if (value === undefined) {
            throw new TypeError("Illegal value for type: " + val);
        }

        return super.set(value);
    }

    // internal
    _refresh_value() {
        // Fetch raw value from provider
        const item = this._provider.get_item(this._itemId);
        const exists = item !== undefined;

        // Cast rawValue to the correct type of undefined
        this._value = exists ? this._typeConfig.validate(item.state) : undefined;

        // Check if value is valid
        const valid = (this._value !== undefined || this._allowUndefined);

        // Use defaultValue
        if (!valid) {
            this._value = this._defaultValue;
        }

        // Use initialValue
        if (this._initialValue !== undefined && !this._isInitialised) {
            if (!(exists && valid)) {
                this._value = this._initialValue;
            }
        }

        // Update isInitialised
        if (exists && valid && !this._isInitialised) {
            this._isInitialised = true;
        }
    }
}

// Alias for backwards compatibility
export { BaseTypedVariable as SharedTypedVariable, VariableType as VarType };
