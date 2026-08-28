import { random_string } from "./util/util.js";

export class SpeculativeProxyCollection {
    constructor(ssclient, proxyCollection, options = {}) {
        this._ssclient = ssclient;
        this._proxyCollection = proxyCollection;
        this._options = options;
        this._path = proxyCollection._path;
        this._terminated = false;

        this._overlay = new Map(); // id -> { item, update_count, is_delete, timestamp }
        this._last_acked_update_count = 0;
        this._handlers = [];
        this._ttlMs = options.ttlMs || options.ttl || 10000;
    }

    get path() {
        return this._path;
    }

    get size() {
        return this.get_items().length;
    }

    get version() {
        return this._proxyCollection.version;
    }

    get provider() {
        return this._proxyCollection;
    }

    has_item(id) {
        this._cleanup_expired();
        if (this._overlay.has(id)) {
            const entry = this._overlay.get(id);
            return !entry.is_delete;
        }
        return this._proxyCollection.has_item(id);
    }

    get_item(id) {
        this._cleanup_expired();
        if (this._overlay.has(id)) {
            const entry = this._overlay.get(id);
            return entry.is_delete ? undefined : entry.item;
        }
        return this._proxyCollection.get_item(id);
    }

    get_items() {
        this._cleanup_expired();
        const baseItems = this._proxyCollection.get_items();
        const map = new Map();

        for (const item of baseItems) {
            map.set(item.id, item);
        }

        for (const [id, entry] of this._overlay.entries()) {
            if (entry.is_delete) {
                map.delete(id);
            } else {
                map.set(id, entry.item);
            }
        }

        return Array.from(map.values());
    }

    _cleanup_expired() {
        if (this._ttlMs <= 0) return;
        const now = Date.now();
        for (const [id, entry] of this._overlay.entries()) {
            if (now - entry.timestamp > this._ttlMs) {
                this._overlay.delete(id);
            }
        }
    }

    _ssclient_terminate() {
        this._terminated = true;
        this._handlers = [];
        this._overlay.clear();
        this._proxyCollection._ssclient_terminate();
    }

    _ssclient_ack(update_count, ok) {
        if (this._terminated) return;

        const stateBefore = this._get_visible_state_map();

        if (typeof update_count === "number" && update_count > 0) {
            this._last_acked_update_count = Math.max(this._last_acked_update_count, update_count);
            for (const [id, entry] of this._overlay.entries()) {
                if (entry.update_count <= this._last_acked_update_count) {
                    this._overlay.delete(id);
                }
            }
        }

        const stateAfter = this._get_visible_state_map();
        const effectiveChanges = this._compute_diff(stateBefore, stateAfter, {}, null);

        if (effectiveChanges.reset || effectiveChanges.insert.length > 0 || effectiveChanges.remove.length > 0) {
            this._notify_callbacks(effectiveChanges);
        }
    }

    _ssclient_update(changes = {}, tunnel = null) {
        if (this._terminated) {
            throw new Error("collection already terminated");
        }

        const stateBefore = this._get_visible_state_map();

        if (tunnel && tunnel.client_id === this._ssclient.id) {
            if (typeof tunnel.update_count === "number") {
                this._last_acked_update_count = tunnel.update_count;
                for (const [id, entry] of this._overlay.entries()) {
                    if (entry.update_count <= this._last_acked_update_count) {
                        this._overlay.delete(id);
                    }
                }
            }
        }

        if (changes && changes.reset === true) {
            this._overlay.clear();
        }

        // Delegate server state update to proxy collection
        this._proxyCollection._ssclient_update(changes, tunnel);

        const stateAfter = this._get_visible_state_map();
        const effectiveChanges = this._compute_diff(stateBefore, stateAfter, changes, tunnel);

        if (effectiveChanges.reset || effectiveChanges.insert.length > 0 || effectiveChanges.remove.length > 0) {
            this._notify_callbacks(effectiveChanges);
        }
    }

    update_items(changes = {}, options = {}) {
        if (this._terminated) {
            throw new Error("collection already terminated");
        }

        const { insert = [], remove = [], reset = false } = changes;

        // Auto-generate missing IDs
        const formattedInsert = insert.map((item) => {
            return { ...item, id: item.id || random_string(10) };
        });

        // Delegate network batching & dispatch directly to ProxyCollection
        const promise = this._proxyCollection.update_items({ insert: formattedInsert, remove, reset }, options);

        // Current pending batch will be dispatched at incremented _update_count
        const currentUpdateCount = ++this._ssclient._update_count;
        const timestamp = Date.now();

        // Queue speculative overlay write and callback notification for microtask tick
        queueMicrotask(() => {
            const stateBefore = this._get_visible_state_map();

            if (reset) {
                this._overlay.clear();
            }

            for (const id of remove) {
                this._overlay.set(id, {
                    item: null,
                    update_count: currentUpdateCount,
                    is_delete: true,
                    timestamp
                });
            }

            for (const item of formattedInsert) {
                this._overlay.set(item.id, {
                    item,
                    update_count: currentUpdateCount,
                    is_delete: false,
                    timestamp
                });
            }

            // Microtask local feedback to facade observers
            const stateAfter = this._get_visible_state_map();
            const effectiveChanges = this._compute_diff(stateBefore, stateAfter, { reset }, null);

            if (effectiveChanges.reset || effectiveChanges.insert.length > 0 || effectiveChanges.remove.length > 0) {
                this._notify_callbacks(effectiveChanges);
            }
        });

        return promise;
    }

    _get_visible_state_map() {
        const visibleMap = new Map();
        for (const item of this._proxyCollection.get_items()) {
            visibleMap.set(item.id, item);
        }
        for (const [id, entry] of this._overlay.entries()) {
            if (entry.is_delete) {
                visibleMap.delete(id);
            } else {
                visibleMap.set(id, entry.item);
            }
        }
        return visibleMap;
    }

    _compute_diff(stateBefore, stateAfter, baseChanges = {}, tunnel = null) {
        const effInsert = [];
        const effRemove = [];

        if (baseChanges.reset) {
            for (const [id, item] of stateAfter.entries()) {
                effInsert.push(item);
            }
            return {
                insert: effInsert,
                remove: Array.from(stateBefore.keys()),
                reset: true,
                version: this._proxyCollection.version
            };
        }

        for (const [id, afterItem] of stateAfter.entries()) {
            const beforeItem = stateBefore.get(id);
            if (!beforeItem || JSON.stringify(beforeItem) !== JSON.stringify(afterItem)) {
                effInsert.push(afterItem);
            }
        }

        for (const id of stateBefore.keys()) {
            if (!stateAfter.has(id)) {
                effRemove.push(id);
            }
        }

        return {
            insert: effInsert,
            remove: effRemove,
            reset: false,
            version: this._proxyCollection.version
        };
    }

    add_callback(handler) {
        const handle = { handler };
        this._handlers.push(handle);
        return handle;
    }

    remove_callback(handle) {
        const index = this._handlers.indexOf(handle);
        if (index > -1) {
            this._handlers.splice(index, 1);
        }
    }

    _notify_callbacks(eArg) {
        this._handlers.forEach(function (handle) {
            handle.handler(eArg);
        });
    }
}
