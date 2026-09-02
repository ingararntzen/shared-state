import { WebSocketIO, ConnectionState } from "./wsio.js";
import { ProxyCollection } from "./ss_collection.js";
import { OptimisticProxyCollection } from "./ss_optimistic_collection.js";
import { MsgType, MsgCmd, normalizePath, validatePath } from "./common.js";
import { random_string, resolvablePromise } from "./util/util.js";

/**
 * SharedStateClient manages logical network connections, subscriptions,
 * state providers, and application objects.
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
        this._subscriptions = new Map();
        this._sub_scheduled = false;

        // state providers (Layer 1)
        this._providers = new Map();

        // Shared Abstractions
        this._collections = new Map(); // path -> WeakRef(Collection)
        this._variables = new Map();   // path -> Map(name -> WeakRef(Variable))

        // connection
        this._connection = new WebSocketIO(url, options);
        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (evt) => this._on_disconnect(evt);
        this._connection.on_message = (data) => this._on_message(data);
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
     * Initializes or retrieves an existing state provider (ProxyCollection / OptimisticProxyCollection) for a given path.
     * @param {string} rawPath - Target path (e.g. "/app/store/res")
     * @param {Object} [options={}] - Options (e.g. { optimistic: true })
     * @returns {ProxyCollection} The initialized or cached state provider instance
     */
    provider(rawPath, options = {}) {
        const path = validatePath(rawPath);

        // set up provider
        if (!this._providers.has(path)) {
            let providerInstance = new ProxyCollection(this, path, options);
            if (options.optimistic ?? true) {
                providerInstance = new OptimisticProxyCollection(this, providerInstance, options);
            }
            this._providers.set(path, providerInstance);
        }

        // register subscriptions
        this._subscriptions.set(path, {});
        this._schedule_sub_sync();

        return this._providers.get(path);
    }

    /**
     * Terminates the client: releases all collections and closes the network connection.
     */
    terminate() {
        for (const [path, providerInstance] of this._providers.entries()) {
            this._subscriptions.delete(path);
            if (providerInstance !== undefined) {
                providerInstance._ssclient_terminate();
            }
        }
        this._providers.clear();
        this._collections.clear();
        this._variables.clear();
        this._subscriptions.clear();
        if (this._connection) {
            this._connection.close();
        }
    }


    /************************************************
     *  CONNECTION
     ************************************************/

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


    /************************************************
     *  COMMUNICATION
     ************************************************/

    /** Parses incoming WebSocket messages, sanitizes structure, and routes REPLY or NOTIFY. */
    _on_message(data) {
        let msg;
        try {
            msg = JSON.parse(data);
        } catch (e) {
            return;
        }

        if (!msg || typeof msg !== "object") return;

        if (msg.path) {
            msg.path = normalizePath(msg.path);
        }
        if (!msg.tunnel || typeof msg.tunnel !== "object") {
            msg.tunnel = {};
        }

        if (msg.type === MsgType.REPLY) {
            this._handle_reply(msg);
        } else if (msg.type === MsgType.MESSAGE || msg.cmd === MsgCmd.NOTIFY) {
            this._handle_notify(msg);
        }
    }

    /** Resolves pending request promise matching request_count. */
    _handle_reply(msg) {
        const request_count = msg.tunnel.request_count;
        if (request_count !== undefined && this._pending_requests.has(request_count)) {
            const resolver = this._pending_requests.get(request_count);
            this._pending_requests.delete(request_count);
            const { ok, data } = msg;
            resolver({ ok, data });
        }

        const update_count = msg.tunnel.update_count;
        if (update_count !== undefined) {
            this._on_ack(update_count, msg.ok !== false, msg.path);
        }
    }

    /** Passes server updates to target ProxyCollection provider. */
    _handle_notify(msg) {
        const update_count = msg.tunnel.update_count;
        if (update_count !== undefined) {
            this._on_ack(update_count, true, msg.path);
        }
        if (this._providers.has(msg.path)) {
            const providerInstance = this._providers.get(msg.path);
            providerInstance._ssclient_update(msg.data, msg.tunnel);
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
                this._subscriptions = new Map(data);
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

    /** Flushes active subscriptions (_subscriptions) to the server in a single PUT /subs request. */
    _sync_subs() {
        this._sub_scheduled = false;
        if (this._connection.state !== ConnectionState.CONNECTED) {
            return;
        }
        const items = Array.from(this._subscriptions.entries());
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
                    this._reconnect("ack_gap");
                    break;
                }
            }
        }

        this._pending_updates.delete(updateCount);
        this._last_acked_update_count = Math.max(this._last_acked_update_count, updateCount);

        if (path && this._providers.has(path)) {
            const providerInstance = this._providers.get(path);
            if (typeof providerInstance._ssclient_ack === "function") {
                providerInstance._ssclient_ack(updateCount, ok);
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
            this._reconnect("timeout");
        }
    }

    /** Triggers immediate WebSocket reconnection when self-healing, ACK gaps, or version gaps occur. */
    _reconnect(reason = "unknown") {
        console.warn(`Reconnect (reason: ${reason})`);
        if (this._connection && this._connection.state === ConnectionState.CONNECTED) {
            this._connection.reconnect(true);
        }
    }


    /************************************************
     *  APP OBJECTS
     ************************************************/

    // path -> WeakRef(Collection)
    _get_collection(path) {
        const ref = this._collections.get(path);
        if (ref) {
            const obj = ref.deref();
            if (obj) {
                return obj;
            } else {
                this._collections.delete(path);
            }
        }
    }

    // path -> WeakRef(Collection)
    _set_collection(path, collection) {
        this._collections.set(path, new WeakRef(collection));
    }


    // path -> Map(name -> WeakRef(Variable))
    _get_variable(path, name) {
        const varMap = this._variables.get(path);
        if (varMap) {
            const ref = varMap.get(name);
            if (ref) {
                const obj = ref.deref();
                if (obj) {
                    return obj;
                } else {
                    varMap.delete(name);
                    if (varMap.size === 0) {
                        this._variables.delete(path);
                    }
                }
            }
        }
    }

    // path -> Map(name -> WeakRef(Variable))
    _set_variable(path, name, variable) {
        let varMap = this._variables.get(path);
        if (!varMap) {
            varMap = new Map();
            this._variables.set(path, varMap);
        }
        varMap.set(name, new WeakRef(variable));
    }
}
