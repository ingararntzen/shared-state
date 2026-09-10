import { random_string, resolvablePromise } from "../util/util.js";
import { sanitizeChanges, serializeChanges } from "../common.js";

export class UpdateBuilder {
    constructor(proxyCollection) {
        this._proxyCollection = proxyCollection;

        this._pendingInserts = new Map();
        this._pendingRemoves = new Set();
        this._pendingReset = false;
        this._pendingConditional = false;

        this._scheduled = false;
        this._sharedPromise = null;
        this._sharedResolver = null;
    }

    add_change(rawChanges = {}, options = {}) {
        const sanitized = sanitizeChanges(rawChanges);
        const { insert, remove, reset } = sanitized;
        const conditional = Boolean(rawChanges.dropIfModified || rawChanges.ifUnmodified || rawChanges.conditional || options.dropIfModified || options.ifUnmodified || options.conditional);

        if (conditional) {
            this._pendingConditional = true;
        }

        if (reset) {
            this._pendingInserts.clear();
            this._pendingRemoves.clear();
            this._pendingReset = true;
        }

        if (remove.size > 0) {
            for (const id of remove) {
                this._pendingInserts.delete(id);
                this._pendingRemoves.add(id);
            }
        }

        if (insert.size > 0) {
            for (let [key, item] of insert.entries()) {
                let id = item.id;
                if (!id) {
                    id = random_string(10);
                    item = { ...item, id };
                }
                this._pendingRemoves.delete(id);
                this._pendingInserts.set(id, item);
            }
        }

        if (!this._scheduled) {
            this._scheduled = true;
            const [promise, resolver] = resolvablePromise();
            this._sharedPromise = promise;
            this._sharedResolver = resolver;

            queueMicrotask(() => this._flush());
        }

        return this._sharedPromise;
    }

    async _flush() {
        const pendingInserts = this._pendingInserts;
        const pendingRemoves = this._pendingRemoves;
        const reset = this._pendingReset;
        const isConditional = this._pendingConditional;
        const resolver = this._sharedResolver;

        // Reset builder state for future synchronous calls
        this._pendingInserts = new Map();
        this._pendingRemoves = new Set();
        this._pendingReset = false;
        this._pendingConditional = false;
        this._scheduled = false;
        this._sharedPromise = null;
        this._sharedResolver = null;

        const payload = serializeChanges({
            insert: pendingInserts,
            remove: pendingRemoves,
            reset: reset
        });

        if (isConditional) {
            payload.last_version = this._proxyCollection._version;
        }

        try {
            const res = await this._proxyCollection._client._update(this._proxyCollection._path, payload);
            resolver(res);
        } catch (err) {
            resolver({ ok: false, error: err });
        }
    }
}

/**
 * ItemProvider manages state replication, key-value item mapping, and update synchronization for a path.
 * @class ItemProvider
 * @implements {CollectionResource}
 */
export class ItemProvider {

    constructor(client, path) {
        this._terminated = false;
        // sharedstate client
        this._client = client;
        this._path = path;
        // callbacks
        this._handlers = [];
        // items
        this._map = new Map();
        // resource version
        this._version = 0;
        // microtask batch update builder
        this._builder = new UpdateBuilder(this);
    }

    /*********************************************************
        APPLICATION API
    **********************************************************/

    get path() { return this._path; }
    get size() { return this._map.size }
    get optimistic() { return false }
    get provider() { return this; }
    has_item(id) { return this._map.has(id) }
    get_item(id) { return this._map.get(id) }
    get_items() { return [...this._map.values()] }

    /**
     * Updates items stored in the path resource across the network.
     * @param {Object} [changes={}] - Delta changes object `{ insert, remove, reset }`
     * @param {Object} [options={}] - Update options
     * @returns {Promise<Object>} Resolves when state update is dispatched/processed
     */
    update_items(changes = {}, options = {}) {
        return this._update_items(changes, options);
    }

    /**
     * application dispatching update to server
     */
    _update_items(changes = {}, options = {}) {
        if (this._terminated) {
            throw new Error("collection already terminated");
        }
        return this._builder.add_change(changes, options);
    }

    /**
     * application register callback
    */
    add_callback(handler) {
        const handle = { handler };
        this._handlers.push(handle);
        return handle;
    };
    remove_callback(handle) {
        const index = this._handlers.indexOf(handle);
        if (index > -1) {
            this._handlers.splice(index, 1);
        }
    };


    /*********************************************************
        SHARED STATE CLIENT API
    **********************************************************/

    /**
     * Collection released by ss client
     */

    _client_terminate() {
        this._terminated = true;
        // empty collection?
        // disconnect from observers
        this._handlers = [];
    }

    /**
     * server update collection 
     */
    _client_update(changes = {}, tunnel = null) {

        if (this._terminated) {
            throw new Error("collection already terminated")
        }

        const incomingVersion = changes.version;

        if (changes && changes.reset) {
            if (incomingVersion !== undefined) {
                this._version = incomingVersion;
            }
        } else if (incomingVersion !== undefined && this._version !== undefined) {
            if (incomingVersion > this._version + 1) {
                console.warn(`Version gap detected on '${this._path}': local version ${this._version}, incoming version ${incomingVersion}. Triggering immediate reconnect.`);
                this._client._reconnect("version_gap");
                return;
            }
            if (incomingVersion <= this._version) {
                // Stale or duplicate notification: no-op
                return;
            }
            this._version = incomingVersion;
        }

        const sanitized = sanitizeChanges(changes);
        const { remove, insert, reset } = sanitized;
        const eff_remove = new Set();
        const eff_insert = new Map();

        if (reset) {
            for (const id of this._map.keys()) {
                eff_remove.add(id);
            }
            this._map = new Map();
        } else {
            for (const _id of remove) {
                if (this._map.has(_id)) {
                    this._map.delete(_id);
                    eff_remove.add(_id);
                }
            }
        }

        for (const [id, item] of insert.entries()) {
            this._map.set(id, item);
            eff_insert.set(id, item);
        }

        const effective_changes = {
            remove: eff_remove,
            insert: eff_insert,
            reset: reset,
            version: this._version
        };

        this._notify_callbacks(effective_changes);
    }

    _notify_callbacks(eArg) {
        this._handlers.forEach(function (handle) {
            handle.handler(eArg);
        });
    };


}
