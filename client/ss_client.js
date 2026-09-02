import { WebSocketIO, ConnectionState } from "./wsio.js";
import { ProxyCollection } from "./ss_collection.js";
import { OptimisticProxyCollection } from "./ss_optimistic_collection.js";
import { MsgType, MsgCmd, validatePath } from "./common.js";
import { random_string, resolvablePromise } from "./util/util.js";

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
        // options
        this._options = options;

        // consistency
        this._client_id = random_string(12);
        this._request_count = 0;
        this._update_count = 0;
        this._last_acked_update_count = 0;
        this._pending_requests = new Map();
        this._pending_updates = new Map();
        this._ttlMs = options.ttlMs || options.ttl || 10000;

        // subscriptions
        this._subs_map = new Map();
        this._sub_scheduled = false;

        // proxy collections
        this._coll_map = new Map();
        this._coll_paths = new Set();
        this._var_coll_paths = new Set();

        // application objects
        this._weakObjects = new Map();
        this._app_objects = {};

        // connection
        this._connection = new WebSocketIO(url, options);
        this._setup_connection_handlers();
        this._connection.connect();
    }


    /************************************************
     *  PUBLIC API
     ************************************************/
    get id() {
        return this._client_id;
    }

    get connection() {
        return this._connection;
    }

    /**
     * Initializes or retrieves an existing ProxyCollection instance for a given path.
     * @param {string} rawPath - Target path (e.g. "/app/store/res")
     * @param {Object} [options={}] - Options (e.g. { optimistic: true })
     * @returns {ProxyCollection} The initialized or cached ProxyCollection
     */
    collection(rawPath, options = {}) {
        const path = validatePath(rawPath);

        // set up proxy collection
        if (!this._coll_map.has(path)) {
            const baseColl = new ProxyCollection(this, path, options);
            const coll = (options.optimistic ?? true)
                ? new OptimisticProxyCollection(this, baseColl, options)
                : baseColl;
            this._coll_map.set(path, coll);
        }

        // register subscriptions
        this._subs_map.set(path, {});
        this._schedule_sub_sync();

        return this._coll_map.get(path);
    }

    /**
     * Terminates the client: releases all collections and closes the network connection.
     */
    terminate() {
        for (const [path, ds] of this._coll_map.entries()) {
            this._subs_map.delete(path);
            this._coll_paths.delete(path);
            this._var_coll_paths.delete(path);
            if (ds !== undefined) {
                ds._ssclient_terminate();
            }
        }
        this._coll_map.clear();
        this._weakObjects.clear();
        this._app_objects = {};
        this._schedule_sub_sync();
        if (this._connection) {
            this._connection.close();
        }
    }


    /************************************************
     *  CONNECTION
     ************************************************/

    _setup_connection_handlers() {
        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (evt) => this._on_disconnect(evt);
        this._connection.on_message = (data) => this._on_message(data);
        this._connection.on_error = (err) => this._on_error(err);
    }


    /** Called automatically when WebSocket connects/reconnects. */
    _on_connect() {
        this._schedule_sub_sync();
    }

    /** Rejects pending request promises on disconnect. */
    _on_disconnect(event) {
        for (const resolver of this._pending_requests.values()) {
            resolver({ ok: false, data: "connection disconnected" });
        }
        this._pending_requests.clear();
        this._pending_updates.clear();
    }

    _on_error(error) { }


    /************************************************
     *  COMMUNICATION
     ************************************************/

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
        if (seq !== undefined && this._pending_requests.has(seq)) {
            const resolver = this._pending_requests.get(seq);
            this._pending_requests.delete(seq);
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
        if (path && !path.startsWith("/")) {
            path = "/" + path;
        }

        if (msg.tunnel && typeof msg.tunnel.update_count === "number" && msg.tunnel.update_count > 0) {
            this._on_ack(msg.tunnel.update_count, true, path);
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
            client_id: this._client_id,
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
        this._pending_requests.set(request_count, resolver);

        return promise.then(({ ok, data }) => {
            if (cmd === MsgCmd.PUT && path === "/subs" && ok) {
                this._subs_map = new Map(data);
            }
            return { ok, path, data };
        });
    }

    /**
     * Executes a GET request against the server.
     * @param {string} path
     */
    _get(path) {
        return this._request(MsgCmd.GET, path);
    }

    /**
     * Executes a PUT request against the server.
     * @param {string} path
     * @param {*} changes
     */
    _update(path, changes) {
        return this._request(MsgCmd.PUT, path, changes);
    }


    /************************************************
     *  SUBSCRIPTIONS
     ************************************************/

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
        if (this._connection.state !== ConnectionState.CONNECTED) {
            return;
        }
        const items = Array.from(this._subs_map.entries());
        const payload = {
            insert: items,
            reset: true
        };
        return this._request(MsgCmd.PUT, "/subs", payload);
    }


    /************************************************
     *  CONSISTENCY
     ************************************************/

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


    /************************************************
     *  APP OBJECTS
     ************************************************/

    _get_weak_object(path) {
        if (!path) return null;
        const ref = this._weakObjects.get(path);
        if (ref) {
            const obj = ref.deref();
            if (obj) return obj;
            this._weakObjects.delete(path);
        }
        return null;
    }

    _set_weak_object(path, obj) {
        if (path && obj) {
            this._weakObjects.set(path, new WeakRef(obj));
        }
    }

}
