import { BaseAbstraction } from "./base_abstraction.js";
import { validatePath } from "../common.js";

/**
 * Base class for all SharedState variables.
 * Extends {@link BaseAbstraction} with single-item state management and change events.
 * @class BaseVariable
 */
export class BaseVariable extends BaseAbstraction {
    /**
     * Initializes a new SharedVariable instance.
     * @param {SharedStateClient} client - The SharedState client instance
     * @param {string} path - Target path prefix (e.g. "/app/vars")
     * @param {string} name - Variable key name (e.g. "counter")
     * @param {Object} [options] - Configuration options
     * @param {string} [token] - Binding lock token (defaults to constructor name)
     */
    constructor(client, path, name, options = {}, token = undefined) {
        if (!name || typeof name !== "string") {
            throw new Error("Variable name must be a non-empty string");
        }
        path = validatePath(path);
        const cached = BaseAbstraction.get_cached_instance(client, path, name);
        if (cached) {
            return cached;
        }

        const tok = token || (new.target && new.target.name) || "BaseVariable";
        super(client, tok, path, name, options);

        BaseAbstraction.cache_instance(client, path, name, this);

        this._itemId = name;
        this._value = undefined;
        this._fullPath = path + "/" + name;

        // Register change callback via ItemResource
        this._resource.add_callback((changes) => {
            this._on_provider_update(changes);
        });
    }

    /**
     * The name/key of the variable.
     * @type {string}
     * @readonly
     */
    get name() { return this._itemId; }

    /**
     * The current local value of the variable.
     * @type {*}
     * @readonly
     */
    get value() {
        this._refresh_value();
        return this._value;
    }

    /**
     * Full path identifying this variable (`path/name`).
     * @type {string}
     * @readonly
     */
    get path() { return this._fullPath; }

    /**
     * Gets the current value of the variable.
     * @returns {*} The current variable value
     */
    get() { return this.value; }

    /**
     * Updates the variable value across the network.
     * @param {*} val - New value to set
     * @returns {Promise<void>} Resolves when state update is processed
     */
    set(val) {
        return this._resource.set(val);
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
        this._value = this._resource.get();
    }
}
