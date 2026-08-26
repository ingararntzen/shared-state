import { WebSocketIO, ConnectionState } from "./wsio.js";
import { resolvablePromise, random_string } from "./util/util.js";
import { ProxyCollection } from "./ss_collection.js";
import { ServerClock, CLOCK } from "./ss_clock.js";
import {
    Variable,
    SharedBool,
    SharedString,
    SharedInteger,
    SharedFloat,
    SharedObject,
    SharedArray
} from "./variables/variables.js";
import { BaseCollection } from "./collections/base_collection.js";
import { SharedSet } from "./collections/set.js";
import { SharedMap } from "./collections/map.js";

const MsgType = Object.freeze({
    MESSAGE: "MESSAGE",
    REQUEST: "REQUEST",
    REPLY: "REPLY"
});

const MsgCmd = Object.freeze({
    GET: "GET",
    PUT: "PUT",
    NOTIFY: "NOTIFY"
});

const TYPE_REGISTRY = {
    Variable: Variable,
    Bool: SharedBool,
    Boolean: SharedBool,
    String: SharedString,
    Integer: SharedInteger,
    Float: SharedFloat,
    Object: SharedObject,
    Array: SharedArray,
    BaseCollection: BaseCollection,
    Collection: BaseCollection,
    Set: SharedSet,
    Map: SharedMap
};

export class SharedStateClient {

    constructor(url, options) {
        // logical connection instance
        this._connection = new WebSocketIO(url, options);

        // client identification & request counters
        this.id = random_string(12);
        this._request_count = 0;
        this._update_count = 0;
        this._pending = new Map();

        // subscriptions
        // path -> {} 
        this._subs_map = new Map();

        // proxy collections {path -> proxy collection}
        this._coll_map = new Map();

        // Layer 2 objects registry {name -> Layer 2 object}
        this.objects = {};

        // Track registered paths for collision protection
        this._coll_paths = new Set();
        this._var_coll_paths = new Set();

        // server clock
        this._server_clock = undefined;

        // bind connection callbacks
        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (event) => this._on_disconnect(event);
        this._connection.on_error = (error) => this._on_error(error);
        this._connection.on_message = (data) => this._on_message(data);

        // initiate connection
        this._connection.connect();
    }

    get state() {
        return this._connection.state;
    }

    get connection() {
        return this._connection;
    }

    get state() {
        return this._connection.state;
    }

    get connection() {
        return this._connection;
    }

    _on_connect() {
        // subscribe on connect/reconnect
        const subs = Array.from(this._subs_map.entries());
        if (subs.length > 0) {
            this._request(MsgCmd.PUT, "/subs", { insert: subs });
        }
    }

    _on_disconnect() {}

    _on_error() {}

    _on_message(data) {
        let msg = JSON.parse(data);
        if (msg.type === MsgType.REPLY) {
            let reqid = typeof msg.tunnel === "object" && msg.tunnel !== null ? msg.tunnel.request_count : msg.tunnel;
            if (this._pending.has(reqid)) {
                let resolver = this._pending.get(reqid);
                this._pending.delete(reqid);
                const { ok, data } = msg;
                resolver({ ok, data });
            }
        } else if (msg.type === MsgType.MESSAGE) {
            if (msg.cmd === MsgCmd.NOTIFY) {
                this._handle_notify(msg);
            }
        }
    }

    _handle_notify(msg) {
        const ds = this._coll_map.get(msg["path"]);
        if (ds !== undefined) {
            ds._ssclient_update(msg["data"], msg["tunnel"]);
        }
    }

    /*********************************************************************
        SERVER REQUESTS
    *********************************************************************/

    async _request(cmd, path, reqData) {
        const request_count = ++this._request_count;
        if (cmd === MsgCmd.PUT && path !== "/subs") {
            this._update_count++;
        }
        const tunnel = {
            client_id: this.id,
            request_count,
            update_count: this._update_count
        };
        const msg = {
            type: MsgType.REQUEST,
            cmd,
            path,
            data: reqData,
            tunnel
        };
        this._connection.send(JSON.stringify(msg));
        let [promise, resolver] = resolvablePromise();
        this._pending.set(request_count, resolver);
        const { ok, data } = await promise;
        if (cmd === MsgCmd.PUT && path === "/subs" && ok) {
            this._subs_map = new Map(data);
        }
        return { ok, path, data };
    }

    async _sub_batch(paths) {
        for (const p of paths) {
            this._subs_map.set(p, {});
        }
        if (this._connection.state === ConnectionState.CONNECTED) {
            const items = [...this._subs_map.entries()];
            return await this.update("/subs", { insert: items, reset: true });
        } else {
            return { ok: true, path: "/subs", data: undefined };
        }
    }

    async _sub(path) {
        return await this._sub_batch([path]);
    }

    async _unsub(path) {
        const subs_map = new Map([...this._subs_map]);
        subs_map.delete(path);
        const items = [...subs_map.entries()];
        return await this.update("/subs", { insert: items, reset: true });
    }

    /*********************************************************************
        API
    *********************************************************************/

    async get(path) {
        return await this._request(MsgCmd.GET, path);
    }

    async update(path, changes) {
        return await this._request(MsgCmd.PUT, path, changes);
    }

    acquire_collection(path, options) {
        path = path.startsWith("/") ? path : "/" + path;
        if (!path.startsWith("/resources/")) {
            path = "/resources" + path;
        }
        if (!this._subs_map.has(path)) {
            this._sub(path);
        }
        if (!this._coll_map.has(path)) {
            this._coll_map.set(path, new ProxyCollection(this, path, options));
        }
        return this._coll_map.get(path);
    }

    load(config) {
        if (!config || typeof config !== "object") {
            throw new Error("client.load() expects a configuration object.");
        }

        const newObjects = {};
        const pathsToSub = [];

        for (const [name, def] of Object.entries(config)) {
            let typeName, rawPath, options;

            if (typeof def === "object" && def !== null) {
                typeName = def.type;
                rawPath = def.path;
                options = def.options || {};
            } else {
                throw new Error(`Invalid configuration for '${name}'. Expected object format: { type: "...", path: "..." }`);
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
                pathsToSub.push(collWirePath);
                const proxyColl = this.acquire_collection(collWirePath, options);
                const obj = new ClassCtor(proxyColl, options);
                this.objects[name] = obj;
                newObjects[name] = obj;

            } else if (segments.length === 4) {
                // Variable Type (4 segments: app/store/resource/itemId)
                const itemId = segments[3];
                const collPathStr = "/" + segments.slice(0, 3).join("/");
                const collWirePath = "/resources" + collPathStr;

                if (this._coll_paths.has(collWirePath)) {
                    throw new Error(`Conflict: Cannot bind Variable '${name}' at '${rawPath}'. Parent collection '${collPathStr}' is already registered as a Collection.`);
                }

                this._var_coll_paths.add(collWirePath);
                pathsToSub.push(collWirePath);
                const proxyColl = this.acquire_collection(collWirePath, options);
                const obj = new ClassCtor(proxyColl, itemId, options);
                this.objects[name] = obj;
                newObjects[name] = obj;

            } else {
                throw new Error(`Invalid path '${rawPath}' for '${name}'. Path must have 3 segments (Collection: /app/store/res) or 4 segments (Variable: /app/store/res/item_id).`);
            }
        }

        if (pathsToSub.length > 0) {
            this._sub_batch(pathsToSub);
        }

        return newObjects;
    }

    release(path) {
        path = path.startsWith("/") ? path : "/" + path;
        if (!path.startsWith("/resources/")) {
            path = "/resources" + path;
        }
        if (this._subs_map.has(path)) {
            this._unsub(path);
        }
        const ds = this._coll_map.get(path);
        if (ds !== undefined) {
            ds._ssclient_terminate();
        }
        this._coll_map.delete(path);
    }
}
