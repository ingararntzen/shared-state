import { random_string, resolvablePromise } from "./util/util.js";

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

    add_change(changes = {}, options = {}) {
        const { insert = [], remove = [], reset = false, conditional = false } = changes;

        if (conditional || options.conditional) {
            this._pendingConditional = true;
        }

        if (reset) {
            this._pendingInserts.clear();
            this._pendingRemoves.clear();
            this._pendingReset = true;
        }

        if (remove.length > 0) {
            for (const id of remove) {
                this._pendingInserts.delete(id);
                this._pendingRemoves.add(id);
            }
        }

        if (insert.length > 0) {
            for (const item of insert) {
                const id = item.id;
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
        const inserts = Array.from(this._pendingInserts.values());
        const removes = Array.from(this._pendingRemoves);
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

        const payload = {
            insert: inserts,
            remove: removes,
            reset: reset
        };

        if (isConditional) {
            payload.last_version = this._proxyCollection._version;
        }

        try {
            const res = await this._proxyCollection._ssclient.update(this._proxyCollection._path, payload);
            resolver(res);
        } catch (err) {
            resolver({ ok: false, error: err });
        }
    }
}

export class ProxyCollection {

    constructor(ssclient, path, options={}) {
        this._options = options;
        this._terminated = false;
        // sharedstate client
        this._ssclient = ssclient;
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
        SHARED STATE CLIENT API
    **********************************************************/

    /**
     * Collection released by ss client
     */

    _ssclient_terminate() {
        this._terminated = true;
        // empty collection?
        // disconnect from observers
        this._handlers = [];
    }

    /**
     * server update collection 
     */
    _ssclient_update (changes={}, tunnel=null) {

        if (this._terminated) {
            throw new Error("collection already terminated")
        }

        if (changes && changes.version !== undefined) {
            this._version = changes.version;
        }

        const {remove=[], insert=[], reset=false} = changes;
        const eff_remove = [];
        const eff_insert = [];

        if (reset) {
            eff_remove.push(...this._map.keys());
            this._map = new Map();
        } else {
            for (const _id of remove) {
                if (this._map.has(_id)) {
                    this._map.delete(_id);
                    eff_remove.push(_id);
                }
            }
        }

        for (const item of insert) {
            this._map.set(item.id, item);
            eff_insert.push(item);
        }

        const effective_changes = {
            remove: eff_remove,
            insert: eff_insert,
            reset: reset,
            version: this._version
        };

        this._notify_callbacks(effective_changes);
    }

    _notify_callbacks (eArg) {
        this._handlers.forEach(function(handle) {
            handle.handler(eArg);
        });
    };

    /*********************************************************
        APPLICATION API
    **********************************************************/

    get size() {return this._map.size}
    has_item(id) {return this._map.has(id)}
    get_item(id) {return this._map.get(id)}
    get_items() {return [...this._map.values()]}
    get version() {return this._version}

    /**
     * application dispatching update to server
     */
    update_items (changes={}, options={}) {
        if (this._terminated) {
            throw new Error("collection already terminated")
        }
        // ensure that inserted items have ids
        const {insert=[]} = changes;
        changes.insert = insert.map((item) => {
            item.id = item.id || random_string(10);
            return item;
        });
        return this._builder.add_change(changes, options);
    }

    /**
     * application register callback
    */
    add_callback (handler) {
        const handle = {handler};
        this._handlers.push(handle);
        return handle;
    };    
    remove_callback (handle) {
        const index = this._handlers.indexOf(handle);
        if (index > -1) {
            this._handlers.splice(index, 1);
        }
    };
}