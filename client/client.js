import { Connection, ConnectionState } from "./connection.js";
import { ItemProvider } from "./providers/item_provider.js";
import { OptimisticItemProvider } from "./providers/optimistic_item_provider.js";
import { SingleItemProvider } from "./providers/single_item_provider.js";
import { ServerClock } from "./server_clock.js";
import { MsgType, MsgCmd, normalizePath, validatePath, sanitizeChanges } from "./common.js";
import { random_string, resolvablePromise, isNumber } from "./util/util.js";

const DEFAULT_FAILURE_TIMEOUT = 10;

/**
 * The `SharedStateClient` manages logical network connections, subscriptions, state providers, and application objects.
 * @class SharedStateClient
 * @see {@link Connection}
 * @see {@link ServerClock}
 * @see {@link CollectionResource}
 * @see {@link ValueResource}
 * @see {@link TokenAccess Token-based Resource Access}
 */
export class SharedStateClient {
    /**
     * Initializes the SharedStateClient.
     * @param {string} url - WebSocket server URL (ws://host:port/)
     * @param {Object} [options] - Configuration options
     * @param {number} [options.failureTimeout=10] - Time in seconds before unacknowledged updates trigger a reconnect
     */
    constructor(url, options = {}) {
        // check options
        if (!isNumber(options.failureTimeout)) {
            options.failureTimeout = DEFAULT_FAILURE_TIMEOUT;
        }

        // options
        this._options = options;

        // consistency
        this._client_id = random_string(12);
        this._request_count = 0;
        this._update_count = 0;
        this._last_acked_update_count = 0;
        this._pending_requests = new Map();
        this._pending_updates = new Map();

        // subscriptions
        this._subscriptions = new Map();
        this._sub_scheduled = false;

        // state providers (Layer 1)
        this._providers = new Map();

        // Binding Locks: path -> identifier (path-exclusive) AND path -> Map(itemID -> identifier) (item-exclusive)
        this._path_bindings = new Map();
        this._item_bindings = new Map();

        // clock sync
        this._serverclock = new ServerClock(this);

        // connection
        this._connection = new Connection(url, options);
        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (evt) => this._on_disconnect(evt);
        this._connection.on_message = (data) => this._on_message(data);
        this._connection.connect();
    }


    /************************************************
     *  PUBLIC API
     ************************************************/
    /**
     * Unique client identifier.
     * @type {string}
     * @readonly
     */
    get id() {
        return this._client_id;
    }

    /**
     * Connection object managing automated reconnects.
     * @type {Connection}
     * @see {@link Connection}
     * @readonly
     */
    get connection() {
        return this._connection;
    }

    /**
     * ServerClock object estimating server time and network latency.
     * @type {ServerClock}
     * @see {@link ServerClock}
     * @readonly
     */
    get serverclock() {
        return this._serverclock;
    }

    /**
     * Request access to a {@link CollectionResource} given token and path.
     * @param {string} token - Access [Token](/design/abstraction/objects#token-based-resource-access)
     * @param {string} path - Resource [Path](/design/representation/item_collection#path)
     * @returns {CollectionResource}
     * @throws {Error} If access was already granted for another token or item-exclusive scope exists
     */
    get_collection_resource(token, path) {
        if (!token || typeof token !== "string") {
            throw new Error("Token must be a non-empty string.");
        }
        path = validatePath(path);

        const existingPathToken = this._path_bindings.get(path);
        if (existingPathToken !== undefined && existingPathToken !== token) {
            throw new Error(`Path '${path}' is already bound to token '${existingPathToken}' (path-exclusive)`);
        }
        const itemMap = this._item_bindings.get(path);
        if (itemMap && itemMap.size > 0) {
            throw new Error(`Path '${path}' already has item-exclusive bindings; cannot bind path-exclusively`);
        }
        this._path_bindings.set(path, token);

        if (!this._providers.has(path)) {
            const baseProvider = new ItemProvider(this, path);
            const providerInstance = new OptimisticItemProvider(this, baseProvider);
            this._providers.set(path, providerInstance);
        }

        this._subscriptions.set(path, {});
        this._schedule_sub_sync();

        return this._providers.get(path);
    }

    /**
     * Request access to a {@link ValueResource} given token, path, and name.
     * @param {string} token - Access [Token](/design/abstraction/objects#token-based-resource-access)
     * @param {string} path - Resource [Path](/design/representation/item_collection#path)
     * @param {string} name - Name of value
     * @returns {ValueResource}
     * @throws {Error} If access was already granted for another token or path-exclusive scope exists
     */
    get_value_resource(token, path, name) {
        if (!token || typeof token !== "string") {
            throw new Error("Token must be a non-empty string.");
        }
        if (!name || typeof name !== "string") {
            throw new Error("name must be a non-empty string.");
        }
        path = validatePath(path);

        const existingPathToken = this._path_bindings.get(path);
        if (existingPathToken !== undefined) {
            throw new Error(`Path '${path}' is already bound to token '${existingPathToken}' (path-exclusive)`);
        }
        let itemMap = this._item_bindings.get(path);
        if (itemMap) {
            const existingItemToken = itemMap.get(name);
            if (existingItemToken !== undefined && existingItemToken !== token) {
                throw new Error(`Path '${path}' item '${name}' is already bound to token '${existingItemToken}'`);
            }
            itemMap.set(name, token);
        } else {
            itemMap = new Map([[name, token]]);
            this._item_bindings.set(path, itemMap);
        }

        if (!this._providers.has(path)) {
            const baseProvider = new ItemProvider(this, path);
            const providerInstance = new OptimisticItemProvider(this, baseProvider);
            this._providers.set(path, providerInstance);
        }

        this._subscriptions.set(path, {});
        this._schedule_sub_sync();

        const providerInstance = this._providers.get(path);
        return new SingleItemProvider(providerInstance, name);
    }

    /**
     * Terminates the client: releases all providers, subscriptions, bindings, and closes the WebSocket connection.
     * @returns {undefined}
     */
    terminate() {
        for (const [path, providerInstance] of this._providers.entries()) {
            this._subscriptions.delete(path);
            if (providerInstance !== undefined) {
                providerInstance._client_terminate();
            }
        }
        this._providers.clear();
        this._path_bindings.clear();
        this._item_bindings.clear();
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
        if (this._serverclock) {
            this._serverclock.restart();
        }
        this._schedule_sub_sync();
    }

    /** Rejects pending request promises on disconnect. */
    _on_disconnect(event) {
        if (this._serverclock && this._serverclock.pinger) {
            this._serverclock.pinger.pause();
        }
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
            const changes = sanitizeChanges(msg.data);
            providerInstance._client_update(changes, msg.tunnel);
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
            if (typeof providerInstance._client_ack === "function") {
                providerInstance._client_ack(updateCount, ok);
            }
        }

        this._check_pending_timeouts();
    }

    /** Checks if the oldest pending update exceeds failureTimeout, triggering reconnect if CONNECTED. */
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

        if (oldestCount !== null && Date.now() - oldestTs > this._options.failureTimeout * 1000) {
            this._reconnect("timeout");
        }
    }

    /** Triggers immediate WebSocket reconnection when self-healing, ACK gaps, or version gaps occur. */
    _reconnect(reason = "unknown") {
        console.warn(`Reconnect (reason: ${reason})`);
        if (this._connection && this._connection.state === ConnectionState.CONNECTED) {
            this._connection.reconnect({ immediate: true });
        }
    }


}
