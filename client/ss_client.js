import { WebSocketIO, ConnectionState } from "./wsio.js";
import { ProxyCollection } from "./ss_collection.js";
import { SpeculativeProxyCollection } from "./ss_speculative_collection.js";
import { SharedMap } from "./collections/map.js";
import { SharedSet } from "./collections/set.js";
import {
    SharedBool,
    SharedString,
    SharedInteger,
    SharedFloat,
    SharedObject,
    SharedArray,
    Variable
} from "./variables/variables.js";

/**
 * Registry mapping abstraction names to their implementation constructors.
 */
export const TYPE_REGISTRY = {
    Map: SharedMap,
    Set: SharedSet,
    Bool: SharedBool,
    String: SharedString,
    Integer: SharedInteger,
    Float: SharedFloat,
    Object: SharedObject,
    Array: SharedArray,
    Variable: Variable
};

export const MsgType = {
    REQUEST: "REQUEST",
    REPLY: "REPLY",
    NOTIFY: "NOTIFY",
    MESSAGE: "MESSAGE"
};

export const MsgCmd = {
    GET: "GET",
    PUT: "PUT",
    NOTIFY: "NOTIFY"
};

function resolvablePromise() {
    let resolver, rejecter;
    const promise = new Promise((resolve, reject) => {
        resolver = resolve;
        rejecter = reject;
    });
    return [promise, resolver, rejecter];
}

function random_string(len = 12) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let res = "";
    for (let i = 0; i < len; i++) {
        res += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return res;
}

/**
 * SharedStateClient manages logical network connections, microtask subscription batching,
 * and high-level object binding (SharedMap, SharedInteger, etc.).
 */
export class SharedStateClient {
    /**
     * Initializes a new SharedState logical client connection.
     * @param {string} url - WebSocket server URL
     * @param {Object} [options] - Configuration options
     */
    constructor(url, options = {}) {
        this._options = options;
        this._connection = new WebSocketIO(url, options);

        this.id = random_string(12);
        this._request_count = 0;
        this._update_count = 0;
        this._last_acked_update_count = 0;
        this._pending = new Map();
        this._pending_updates = new Map(); // update_count -> { timestamp, path, changes }
        this._ttlMs = options.ttlMs || options.ttl || 10000;

        // Subscriptions state: path -> {}
        this._subs_map = new Map();
        this._sub_scheduled = false;

        // Cached proxy collections: path -> ProxyCollection / SpeculativeProxyCollection
        this._coll_map = new Map();

        // Bound Layer 2 objects: name -> Layer 2 instance (e.g. SharedMap)
        this.objects = {};

        // Collision detection tracking sets
        this._coll_paths = new Set();
        this._var_coll_paths = new Set();

        this._setup_connection_handlers();
        this._connection.connect();
    }

    get connection() {
        return this._connection;
    }

    get state() {
        return this._connection.state;
    }

    _setup_connection_handlers() {
        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (evt) => this._on_disconnect(evt);
        this._connection.on_message = (data) => this._on_message(data);
        this._connection.on_error = (err) => this._on_error(err);
    }

    connect() {
        return this._connection.connect();
    }

    /** Called automatically when WebSocket connects/reconnects. */
    _on_connect() {
        this._schedule_sub_sync();
    }

    /** Rejects pending request promises on disconnect. */
    _on_disconnect(event) {
        for (const resolver of this._pending.values()) {
            resolver({ ok: false, data: "connection disconnected" });
        }
        this._pending.clear();
        this._pending_updates.clear();
    }

    _on_error(error) { }

    /** Parses incoming WebSocket messages and routes REPLY or NOTIFY. */
    _on_message(data) {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            return;
        }

        if (msg.type === MsgType.REPLY) {
            this._handle_reply(msg);
        } else if (msg.type === MsgType.MESSAGE || msg.cmd === MsgCmd.NOTIFY) {
            this._handle_notify(msg);
        }
    }

    /** Resolves pending request promise matching request_count. */
    _handle_reply(msg) {
        const seq = msg.tunnel ? msg.tunnel.request_count : undefined;
        if (seq !== undefined && this._pending.has(seq)) {
            const resolver = this._pending.get(seq);
            this._pending.delete(seq);
            const { ok, data } = msg;
            resolver({ ok, data });
        }

        if (msg.tunnel && typeof msg.tunnel.update_count === "number" && msg.tunnel.update_count > 0) {
            this._on_ack(msg.tunnel.update_count, msg.ok !== false, msg.path);
        }
    }

    /** Normalizes path and passes server updates to target ProxyCollection. */
    _handle_notify(msg) {
        let path = msg.path || "";
        path = path.startsWith("/") ? path : "/" + path;
        if (!path.startsWith("/resources/")) {
            path = "/resources" + path;
        }

        if (msg.tunnel && typeof msg.tunnel.update_count === "number" && msg.tunnel.update_count > 0) {
            this._on_ack(msg.tunnel.update_count, true, path);
        }

        if (this._coll_map.has(path)) {
            const coll = this._coll_map.get(path);
            coll._ssclient_update(msg.data, msg.tunnel);
        }
    }

    /** ACK handling for update_count confirming request processing or rejection. */
    _on_ack(updateCount, ok, path) {
        if (!updateCount || updateCount <= 0) return;

        // Gap check: if updateCount jumps past un-ACKed pending updates, trigger reconnect
        if (updateCount > this._last_acked_update_count + 1) {
            for (const [count] of this._pending_updates.entries()) {
                if (count < updateCount) {
                    console.warn(`Unacked gap detected in pending_updates: count ${count} skipped by ack ${updateCount}. Triggering reconnect.`);
                    this._handle_version_gap(path, 0, 0);
                    break;
                }
            }
        }

        this._pending_updates.delete(updateCount);
        this._last_acked_update_count = Math.max(this._last_acked_update_count, updateCount);

        let normPath = path || "";
        if (normPath && !normPath.startsWith("/")) normPath = "/" + normPath;
        if (normPath && !normPath.startsWith("/resources/")) normPath = "/resources" + normPath;

        if (normPath && this._coll_map.has(normPath)) {
            const coll = this._coll_map.get(normPath);
            if (typeof coll._ssclient_ack === "function") {
                coll._ssclient_ack(updateCount, ok);
            }
        }

        this._check_pending_timeouts();
    }

    /** Checks if the oldest pending update exceeds ttlMs, triggering reconnect if CONNECTED. */
    _check_pending_timeouts() {
        if (this._pending_updates.size === 0) return;

        let oldestCount = null;
        let oldestTs = Infinity;
        for (const [count, entry] of this._pending_updates.entries()) {
            if (entry.timestamp < oldestTs) {
                oldestTs = entry.timestamp;
                oldestCount = count;
            }
        }

        if (oldestCount !== null && Date.now() - oldestTs > this._ttlMs) {
            if (this._connection && this._connection.state === ConnectionState.CONNECTED) {
                console.warn(`Unacked update ${oldestCount} timed out after ${this._ttlMs}ms. Triggering self-healing reconnect.`);
                this._handle_version_gap("", 0, 0);
            }
        }
    }

    /** Triggers immediate WebSocket reconnection when a version discontinuity gap is detected. */
    _handle_version_gap(path, localVer, incomingVer) {
        if (this._connection && this._connection.state === ConnectionState.CONNECTED) {
            this._connection.reconnect(true);
        }
    }

    /**
     * Sends a WebSocket REQUEST message to the server.
     * @param {string} cmd - Request command (GET, PUT)
     * @param {string} path - Target path
     * @param {*} reqData - Request payload data
     * @returns {Promise<{ok: boolean, path: string, data: *}>}
     */
    _request(cmd, path, reqData) {
        const request_count = ++this._request_count;
        if (cmd === MsgCmd.PUT && path !== "/subs") {
            this._update_count++;
            this._pending_updates.set(this._update_count, {
                timestamp: Date.now(),
                path,
                changes: reqData
            });
        }

        const tunnel = {
            client_id: this.id,
            request_count: request_count,
            update_count: this._update_count
        };

        const msg = {
            type: MsgType.REQUEST,
            cmd: cmd,
            path: path,
            data: reqData,
            tunnel: tunnel
        };

        this._connection.send(JSON.stringify(msg));
        const [promise, resolver] = resolvablePromise();
        this._pending.set(request_count, resolver);

        return promise.then(({ ok, data }) => {
            if (cmd === MsgCmd.PUT && path === "/subs" && ok) {
                this._subs_map = new Map(data);
            }
            return { ok, path, data };
        });
    }

    /** Schedules a subscription sync on the microtask tick. */
    _schedule_sub_sync() {
        if (!this._sub_scheduled) {
            this._sub_scheduled = true;
            queueMicrotask(() => this._sync_subs());
        }
    }

    /** Flushes active subscriptions (_subs_map) to the server in a single PUT /subs request. */
    _sync_subs() {
        this._sub_scheduled = false;
        if (this.state !== ConnectionState.CONNECTED) {
            return;
        }
        const items = Array.from(this._subs_map.entries());
        const payload = {
            insert: items,
            reset: true
        };
        return this._request(MsgCmd.PUT, "/subs", payload);
    }

    /**
     * Acquires and caches ProxyCollection instances for a batch of path specs.
     * @param {Array<{path: string, options?: Object}>} specs
     * @returns {Map<string, ProxyCollection>} Map of normalized wire path -> ProxyCollection
     */
    _acquire_collections(specs = []) {
        const acquired = new Map();

        for (const spec of specs) {
            const rawPath = spec.path;
            const options = spec.options || {};
            const localUpdate = options.local_update ?? true;

            let path = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
            if (!path.startsWith("/resources/")) {
                path = "/resources" + path;
            }

            this._subs_map.set(path, {});

            if (!this._coll_map.has(path)) {
                const baseColl = new ProxyCollection(this, path, options);
                const coll = localUpdate
                    ? new SpeculativeProxyCollection(this, baseColl, options)
                    : baseColl;
                this._coll_map.set(path, coll);
            }

            acquired.set(path, this._coll_map.get(path));
        }

        this._schedule_sub_sync();
        return acquired;
    }

    /**
     * Releases specified collection paths (or all active collections if paths is null).
     * @param {Array<string>|null} [paths]
     */
    _release_collections(paths = null) {
        const targetPaths = paths || Array.from(this._coll_map.keys());

        for (const path of targetPaths) {
            this._subs_map.delete(path);
            this._coll_paths.delete(path);
            this._var_coll_paths.delete(path);

            const ds = this._coll_map.get(path);
            if (ds !== undefined) {
                ds._ssclient_terminate();
            }
            this._coll_map.delete(path);
        }

        if (!paths) {
            this.objects = {};
        } else {
            for (const [name, obj] of Object.entries(this.objects)) {
                if (obj._proxyCollection && targetPaths.includes(obj._proxyCollection.path)) {
                    delete this.objects[name];
                }
            }
        }

        this._schedule_sub_sync();
    }

    /*********************************************************************
        PUBLIC API
    *********************************************************************/

    /**
     * Executes a raw GET request against the server.
     * @param {string} path
     */
    get(path) {
        return this._request(MsgCmd.GET, path);
    }

    /**
     * Executes a raw PUT update request against the server.
     * @param {string} path
     * @param {*} changes
     */
    update(path, changes) {
        return this._request(MsgCmd.PUT, path, changes);
    }

    /**
     * Configures and loads Layer-2 abstraction objects (SharedMap, SharedInteger, etc.).
     * @param {Object<string, {type: string, path: string, options?: Object, local_update?: boolean}>} config
     * @returns {Object<string, *>} Map of bound abstraction instances
     */
    load(config) {
        if (!config || typeof config !== "object") {
            throw new Error("client.load() expects a configuration object.");
        }

        const newObjects = {};
        const specs = [];
        const itemsToInstantiate = [];

        for (const [name, def] of Object.entries(config)) {
            if (!def || typeof def !== "object") {
                throw new Error(`Invalid configuration for '${name}'. Expected object format: { type: "...", path: "..." }`);
            }

            const typeName = def.type;
            const rawPath = def.path;
            const options = def.options || {};
            if (def.local_update !== undefined) {
                options.local_update = def.local_update;
            }

            if (!typeName || !TYPE_REGISTRY[typeName]) {
                throw new Error(`Unknown or missing type '${typeName}' for '${name}'. Supported types: ${Object.keys(TYPE_REGISTRY).join(", ")}`);
            }

            if (!rawPath || typeof rawPath !== "string") {
                throw new Error(`Path missing or invalid for '${name}'.`);
            }

            let normPath = rawPath.startsWith("/") ? rawPath : "/" + rawPath;
            let cleanPath = normPath.startsWith("/resources/") ? normPath.slice(10) : (normPath.startsWith("/resources") ? normPath.slice(10) : normPath);
            const segments = cleanPath.split("/").filter(Boolean);

            const ClassCtor = TYPE_REGISTRY[typeName];

            if (segments.length === 3) {
                // Collection Type (3 segments: app/store/resource)
                const collWirePath = normPath.startsWith("/resources/") ? normPath : "/resources" + normPath;

                if (this._var_coll_paths.has(collWirePath)) {
                    throw new Error(`Conflict: Cannot register Collection '${name}' at '${rawPath}'. Path is already reserved for Variables.`);
                }

                this._coll_paths.add(collWirePath);
                specs.push({ path: collWirePath, options });
                itemsToInstantiate.push({ name, ClassCtor, collWirePath, isVariable: false, options });

            } else if (segments.length === 4) {
                // Variable Type (4 segments: app/store/resource/itemId)
                const itemId = segments[3];
                const collPathStr = "/" + segments.slice(0, 3).join("/");
                const collWirePath = "/resources" + collPathStr;

                if (this._coll_paths.has(collWirePath)) {
                    throw new Error(`Conflict: Cannot bind Variable '${name}' at '${rawPath}'. Parent collection '${collPathStr}' is already registered as a Collection.`);
                }

                this._var_coll_paths.add(collWirePath);
                specs.push({ path: collWirePath, options });
                itemsToInstantiate.push({ name, ClassCtor, collWirePath, isVariable: true, itemId, options });

            } else {
                throw new Error(`Invalid path '${rawPath}' for '${name}'. Path must have 3 segments (Collection: /app/store/res) or 4 segments (Variable: /app/store/res/item_id).`);
            }
        }

        const acquiredMaps = this._acquire_collections(specs);

        for (const item of itemsToInstantiate) {
            const proxyColl = acquiredMaps.get(item.collWirePath);
            let obj;
            if (item.isVariable) {
                obj = new item.ClassCtor(proxyColl, item.itemId, item.options);
            } else {
                obj = new item.ClassCtor(proxyColl, item.options);
            }
            this.objects[item.name] = obj;
            newObjects[item.name] = obj;
        }

        return newObjects;
    }

    /**
     * Terminates the client session: releases all collections and closes the network connection.
     */
    terminate() {
        this._release_collections();
        if (this._connection) {
            this._connection.close();
        }
    }
}
