import { BaseAbstraction } from "./base_abstraction.js";
import { validatePath } from "../common.js";

/**
 * SharedVariable represents an online-hosted value.
 * Extends {@link BaseAbstraction}.
 * 
 * `SharedVariable` implements the {@link Events} interface.
 * All state changes are emitted on the `"change"` event, with `{new: newValue, old: oldValue}` as callback payload.
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

        // Register change callback via ItemResource / ValueResource
        this._resource.add_callback((diff) => {
            this._on_resource_update(diff);
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
        return this._resource.get();
    }

    /**
     * Gets the current value of the variable.
     * @returns {*} The current variable value
     */
    get() { return this.value; }

    /**
     * Updates the variable value across the network.
     * @param {*} val - New value to set
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    set(val) {
        return this._resource.set(val);
    }

    // internal event handler
    _on_resource_update(diff) {
        this.emit("change", diff);
    }

    get_current_state(name) {
        if (name === "change") {
            const val = this.value;
            if (val === undefined) return null;
            return { new: val, old: undefined };
        }
        return null;
    }
}
