import eventify from "../util/events.js";
import { validatePath } from "../common.js";

/**
 * Base class for all SharedState abstractions (Variables and Collections).
 * Extends objects with path/provider accessors and event handling (`on`, `off`, `once`).
 * Manages singleton instance caching via WeakRef.
 * @class BaseAbstraction
 */
export class BaseAbstraction {
    /** @type {Map<string, WeakRef>} */
    static _path_instances = new Map();

    /** @type {Map<string, Map<string, WeakRef>>} */
    static _item_instances = new Map();

    /**
     * Retrieves an active cached instance for a path or (path, itemID).
     * @param {string} path - Canonical path
     * @param {string} [itemID] - Target item ID (omit for path-exclusive collections)
     * @returns {BaseAbstraction|null} Active cached instance or null
     */
    static get_cached_instance(path, itemID = undefined) {
        path = validatePath(path);
        if (itemID === undefined) {
            const ref = BaseAbstraction._path_instances.get(path);
            if (ref) {
                const inst = ref.deref();
                if (inst) return inst;
                BaseAbstraction._path_instances.delete(path);
            }
        } else {
            const itemMap = BaseAbstraction._item_instances.get(path);
            if (itemMap) {
                const ref = itemMap.get(itemID);
                if (ref) {
                    const inst = ref.deref();
                    if (inst) return inst;
                    itemMap.delete(itemID);
                    if (itemMap.size === 0) {
                        BaseAbstraction._item_instances.delete(path);
                    }
                }
            }
        }
        return null;
    }

    /**
     * Caches a new instance under path or (path, itemID) using WeakRef.
     * @param {string} path - Canonical path
     * @param {string} [itemID] - Target item ID (omit for path-exclusive collections)
     * @param {BaseAbstraction} instance - Instance to cache
     */
    static cache_instance(path, itemID, instance) {
        path = validatePath(path);
        if (itemID === undefined) {
            BaseAbstraction._path_instances.set(path, new WeakRef(instance));
        } else {
            let itemMap = BaseAbstraction._item_instances.get(path);
            if (!itemMap) {
                itemMap = new Map();
                BaseAbstraction._item_instances.set(path, itemMap);
            }
            itemMap.set(itemID, new WeakRef(instance));
        }
    }

    /**
     * Initializes a BaseAbstraction instance.
     * @param {SharedStateClient} client - The parent SharedState client instance
     * @param {string} token - Token for binding reservation (e.g. class name)
     * @param {string} path - Canonical path for this state object
     * @param {string} [itemID] - Target item ID if item-exclusive
     * @param {Object} [options] - Options passed to provider initialization
     */
    constructor(client, token, path, itemID = undefined, options = {}) {
        if (!client || typeof client.provider !== "function") {
            throw new Error(`Client must be an instance of SharedStateClient or implement provider().`);
        }
        path = validatePath(path);
        this._client = client;
        this._path = path;
        this._options = options;
        this._token = token;

        const [reader, updater] = client.provider(token, path, itemID, options);
        this._reader = reader;
        this._updater = updater;
        this._provider = reader.provider || reader;
    }

    /**
     * Canonical path of the object's provider.
     * @type {string}
     * @readonly
     */
    get path() { return this._path; }

    /**
     * The underlying Layer 1 state provider.
     * @type {Object}
     * @readonly
     */
    get provider() { return this._provider; }

    /**
     * The reader object (`ItemReader` or provider instance).
     * @type {Object}
     * @readonly
     */
    get reader() { return this._reader; }

    /**
     * The updater object (`ItemUpdater` or collection updater).
     * @type {Object}
     * @readonly
     */
    get updater() { return this._updater; }

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
