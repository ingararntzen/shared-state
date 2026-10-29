import { BaseAbstraction } from "./base_abstraction.js";
import { validatePath } from "../common.js";

/**
 * Value diff payload delivered to variable change handlers.
 * @typedef {Object} VariableDiff
 * @property {*} new - The newly updated value
 * @property {*} old - The previous value (or undefined on initial state)
 */

/**
 * Handler function signature invoked when variable value changes.
 * Variables yield a convenient `diff` object (`{ new, old }`), unlike collections which yield `changes` (`{ insert, remove, reset }`).
 *
 * @callback VariableChangeHandler
 * @param {VariableDiff} diff - Value diff object `{ new: *, old: * }`
 * @param {EventInfo} eInfo - Event metadata object detailing source, count, init status, and subscription handle
 */

/**
 * SharedVariable represents an online-hosted value.
 * Extends {@link BaseAbstraction}.
 * 
 * `SharedVariable` is enhanced with the {@link Events} interface (`eventify`).
 * Subscribing via `.on_change(handler, [options])` registers a handler for state changes, receiving `{new: newValue, old: oldValue}` as handler payload.
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
        this._resource.add_handler((diff) => {
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

    /**
     * Subscribes to value change events on the variable.
     * @param {VariableChangeHandler} handler - Handler function receiving `(diff, eInfo)`
     * @param {Object} [options] - Subscription options
     * @param {boolean} [options.init=false] - If true, delivers initial state upon subscription
     * @param {boolean} [options.once=false] - If true, automatically cancels the subscription after its first invocation
     * @returns {Subscription} Subscription handle with `.cancel()` method
     */
    on_change(handler, options) {
        return super.on_change(handler, options);
    }

    // internal event handler
    _on_resource_update(diff) {
        this._emit(diff);
    }

    get_current_state() {
        const val = this.value;
        if (val === undefined) return null;
        return { new: val, old: undefined };
    }
}
