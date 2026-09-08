import { BaseAbstraction } from "./base_abstraction.js";

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
     */
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
    get value() { return this._value; }

    /**
     * Full path identifying this variable (`path/name`).
     * @type {string}
     * @readonly
     */
    get path() { return this._path; }

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
