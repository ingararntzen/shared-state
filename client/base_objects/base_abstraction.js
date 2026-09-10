import eventify from "../util/events.js";
import { validatePath } from "../common.js";

/**
 * Base class for all SharedState abstractions (Variables and Collections).
 * Extends objects with path/provider accessors and event handling (`on`, `off`, `once`).
 * Manages per-client singleton instance caching via WeakMap and WeakRef.
 * @class BaseAbstraction
 */
export class BaseAbstraction {
    /** @type {WeakMap<Object, Map<string, WeakRef>>} */
    static _path_instances = new WeakMap();

    /** @type {WeakMap<Object, Map<string, Map<string, WeakRef>>>} */
    static _item_instances = new WeakMap();

    /**
     * Retrieves an active cached instance for a client and path or (path, itemID).
     * @param {Object} client - Target SharedState client
     * @param {string} path - Canonical path
     * @param {string} [itemID] - Target item ID (omit for path-exclusive collections)
     * @returns {BaseAbstraction|null} Active cached instance or null
     */
    static get_cached_instance(client, path, itemID = undefined) {
        if (!client) return null;
        path = validatePath(path);
        if (itemID === undefined) {
            const clientMap = BaseAbstraction._path_instances.get(client);
            if (clientMap) {
                const ref = clientMap.get(path);
                if (ref) {
                    const inst = ref.deref();
                    if (inst) return inst;
                    clientMap.delete(path);
                }
            }
        } else {
            const clientMap = BaseAbstraction._item_instances.get(client);
            if (clientMap) {
                const itemMap = clientMap.get(path);
                if (itemMap) {
                    const ref = itemMap.get(itemID);
                    if (ref) {
                        const inst = ref.deref();
                        if (inst) return inst;
                        itemMap.delete(itemID);
                        if (itemMap.size === 0) {
                            clientMap.delete(path);
                        }
                    }
                }
            }
        }
        return null;
    }

    /**
     * Caches a new instance under client and path or (path, itemID) using WeakRef.
     * @param {Object} client - Target SharedState client
     * @param {string} path - Canonical path
     * @param {string} [itemID] - Target item ID (omit for path-exclusive collections)
     * @param {BaseAbstraction} instance - Instance to cache
     */
    static cache_instance(client, path, itemID, instance) {
        if (!client) return;
        path = validatePath(path);
        if (itemID === undefined) {
            let clientMap = BaseAbstraction._path_instances.get(client);
            if (!clientMap) {
                clientMap = new Map();
                BaseAbstraction._path_instances.set(client, clientMap);
            }
            clientMap.set(path, new WeakRef(instance));
        } else {
            let clientMap = BaseAbstraction._item_instances.get(client);
            if (!clientMap) {
                clientMap = new Map();
                BaseAbstraction._item_instances.set(client, clientMap);
            }
            let itemMap = clientMap.get(path);
            if (!itemMap) {
                itemMap = new Map();
                clientMap.set(path, itemMap);
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
        if (!client || typeof client.get_collection_resource !== "function" || typeof client.get_value_resource !== "function") {
            throw new Error(`Client must be an instance of SharedStateClient implementing get_collection_resource and get_value_resource.`);
        }
        path = validatePath(path);
        this._client = client;
        this._path = path;
        this._options = options;
        this._token = token;

        if (itemID === undefined) {
            this._resource = client.get_collection_resource(token, path);
        } else {
            this._resource = client.get_value_resource(token, path, itemID);
        }
    }

    /**
     * Canonical path of the object's provider.
     * @type {string}
     * @readonly
     */
    get path() { return this._path; }

    /**
     * The underlying PathResource (ItemProvider instance).
     * @type {Object}
     * @readonly
     */
    get provider() { return this._resource.provider; }

    /**
     * The resource handle (`PathResource` or `ItemResource`).
     * @type {Object}
     * @readonly
     */
    get resource() { return this._resource; }

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
