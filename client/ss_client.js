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
        this._pending = new Map();

        // Subscriptions state: path -> {}
        this._subs_map = new Map();
        this._sub_scheduled = false;

        // Cached proxy collections: path -> ProxyCollection / SpeculativeProxyCollection
        this._coll_map = new Map();

        // Bound Layer 2 objects: name -> Layer 2 instance (e.g. SharedMap)
        this.objects = {};

        // Track registered paths for collision detection
        this._coll_paths = new Set();
        this._var_coll_paths = new Set();

        this._server_clock = undefined;

        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (event) => this._on_disconnect(event);
        this._connection.on_error = (error) => this._on_error(error);
        this._connection.on_message = (data) => this._on_message(data);

        this._connection.connect();
    }

    /** Connection state getter */
    get state() {
        return this._connection.state;
    }

    /** WebSocketIO connection instance getter */
    get connection() {
        return this._connection;
    }

    /** Called automatically when WebSocket connects/reconnects. */
    _on_connect() {
        this._sync_subs();
    }

    /** Rejects pending request promises on disconnect. */
    _on_disconnect(event) {
        for (const [seq, resolver] of this._pending.entries()) {
            resolver({ ok: false, error: "WebSocket disconnected" });
        }
        this._pending.clear();
    }

    _on_error(error) {}

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
    }

    /** Normalizes path and passes server updates to target ProxyCollection. */
    _handle_notify(msg) {
        let path = msg.path || "";
        path = path.startsWith("/") ? path : "/" + path;
        if (!path.startsWith("/resources/")) {
            path = "/resources" + path;
        }
        if (this._coll_map.has(path)) {
            const coll = this._coll_map.get(path);
            coll._ssclient_update(msg.data, msg.tunnel);
        }
    }

    /**
     * Sends a WebSocket REQUEST message to the server.
     * @param {string} cmd - Request command (GET, PUT)
     * @param {string} path - Target path
     * @param {*} reqData - Request payload data
     * @returns {Promise<{ok: boolean, path: string, data: *}>}
     */
    async _request(cmd, path, reqData) {
        const request_count = ++this._request_count;
        if (cmd === MsgCmd.PUT && path !== "/subs") {
            this._update_count++;
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
        const { ok, data } = await promise;

        if (cmd === MsgCmd.PUT && path === "/subs" && ok) {
            this._subs_map = new Map(data);
        }
        return { ok, path, data };
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
        return this._request(MsgCmd.PUT, "/subs", payload).catch(() => {});
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
    async get(path) {
        return await this._request(MsgCmd.GET, path);
    }

    /**
     * Executes a raw PUT update request against the server.
     * @param {string} path
     * @param {*} changes
     */
    async update(path, changes) {
        return await this._request(MsgCmd.PUT, path, changes);
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
