import eventify from "../util/events.js";
import { validatePath } from "../common.js";

/**
 * Base class for all SharedState abstractions (Variables and Collections).
 * Extends objects with path/provider accessors and event handling (`on`, `off`, `once`).
 * @class BaseAbstraction
 */
export class BaseAbstraction {
    /**
     * Initializes a BaseAbstraction instance.
     * @param {SharedStateClient} client - The parent SharedState client instance
     * @param {string} path - Canonical path for this state object
     * @param {Object} [options] - Options passed to provider initialization
     */
    constructor(client, path, options) {
        if (!client || typeof client.provider !== "function") {
            throw new Error(`Client must be an instance of SharedStateClient or implement provider().`);
        }
        const normPath = validatePath(path);
        this._client = client;
        this._normPath = normPath;
        this._options = options;
        this._provider = client.provider(normPath, options);
    }

    /**
     * The full canonical path of the object's provider.
     * @type {string}
     * @readonly
     */
    get path() { return this._provider.path; }

    /**
     * Normalized path string.
     * @type {string}
     * @readonly
     */
    get normPath() { return this._normPath; }

    /**
     * The underlying Layer 1 state provider.
     * @type {Object}
     * @readonly
     */
    get provider() { return this._provider; }

    /**
     * The parent SharedState client instance.
     * @type {SharedStateClient}
     * @readonly
     */
    get client() { return this._client; }

    /**
     * Subscribe to state change events.
     * @param {string} name - Event name (e.g. "change")
     * @param {Function} callback - Callback function receiving `(state, eInfo)`
     * @param {Object} [options] - Event options (e.g. `{ init: true }` for immediate initial state delivery)
     * @returns {Object} Subscription handle with `.off()` method
     */
    on(name, callback, options) {}

    /**
     * Unsubscribe from events.
     * @param {Object|string} handleOrName - Subscription handle or event name
     * @param {Function} [callback] - Callback function to remove if name was specified
     */
    off(handleOrName, callback) {}

    /**
     * Subscribe to a single state change event execution.
     * @param {string} name - Event name
     * @param {Function} callback - Callback function
     * @param {Object} [options] - Event options
     * @returns {Object} Subscription handle
     */
    once(name, callback, options) {}
}

eventify(BaseAbstraction.prototype);

