(function(global, factory) {
	typeof exports === "object" && typeof module !== "undefined" ? factory(exports) : typeof define === "function" && define.amd ? define(["exports"], factory) : (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.SHAREDSTATE = {}));
})(this, function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region client/util/util.js
	function resolvablePromise() {
		let resolver;
		return [new Promise((resolve, reject) => {
			resolver = resolve;
		}), resolver];
	}
	function random_string(length) {
		var text = "";
		var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
		for (var i = 0; i < length; i++) text += possible.charAt(Math.floor(Math.random() * possible.length));
		return text;
	}
	function isNumber(val) {
		return typeof val === "number" && !Number.isNaN(val);
	}
	//#endregion
	//#region client/connection.js
	var MAX_RETRIES = 4;
	/**
	* Connection states enum for the Connection manager.
	* @readonly
	* @enum {string}
	* @property {string} DISCONNECTED - Connection is closed pending connect (INITIAL STATE).
	* @property {string} CONNECTING - Connection attempt in progress
	* @property {string} CONNECTED - Connection is active
	* @property {string} TERMINATED - Connection was closed and will not reconnect (FINAL STATE).
	*/
	var ConnectionState = Object.freeze({
		DISCONNECTED: "disconnected",
		CONNECTING: "connecting",
		CONNECTED: "connected",
		TERMINATED: "terminated"
	});
	/**
	* Connection manages connection state during automated reconnect cycles.
	* @class Connection
	*/
	var Connection = class {
		/**
		* Initializes a Connection instance (managed internally by SharedStateClient).
		* @internal
		* @param {string} url - WebSocket server URL
		* @param {Object} [options] - Configuration options
		* @param {Function} [options.WebSocket] - Custom WebSocket class constructor (useful in Node.js environments)
		* @param {number} [options.retries=4] - Maximum retry attempts before marking connection as terminated
		*/
		constructor(url, options = {}) {
			this._url = url;
			this._ws = void 0;
			this._state = ConnectionState.DISCONNECTED;
			this._options = options;
			this._retries = 0;
			this._connect_promise_resolvers = [];
		}
		/**
		* Current connection state.
		* @type {ConnectionState}
		* @readonly
		*/
		get state() {
			return this._state;
		}
		/**
		* WebSocket URL.
		* @type {string}
		* @readonly
		*/
		get url() {
			return this._url;
		}
		/**
		* Initiates the WebSocket connection (internal use by SharedStateClient).
		* @internal
		* @returns {void}
		*/
		connect() {
			if (this._state === ConnectionState.CONNECTING || this._state === ConnectionState.CONNECTED) {
				console.log("Connect while connecting or connected");
				return;
			}
			if (this._is_terminated()) {
				console.log("Terminated");
				return;
			}
			const WS = this._options.WebSocket || (typeof WebSocket !== "undefined" ? WebSocket : globalThis.WebSocket);
			if (!WS) throw new Error("WebSocket implementation not found. In Node.js environments, pass options.WebSocket or define globalThis.WebSocket.");
			this._ws = new WS(this._url);
			this._state = ConnectionState.CONNECTING;
			this._ws.onopen = (e) => this._on_open(e);
			this._ws.onmessage = (e) => this.on_message(e.data);
			this._ws.onclose = (e) => this._on_close(e);
			this._ws.onerror = (e) => this.on_error(e);
			this.on_connecting();
		}
		_on_open(event) {
			this._state = ConnectionState.CONNECTED;
			for (const resolver of this._connect_promise_resolvers) resolver();
			this._connect_promise_resolvers = [];
			this._retries = 0;
			this.on_connect();
		}
		_on_close(event) {
			this._state = ConnectionState.DISCONNECTED;
			this.on_disconnect(event);
			this._retries += 1;
			if (!this._is_terminated()) setTimeout(() => {
				this.connect();
			}, 1e3 * this._retries);
		}
		_is_terminated() {
			const { retries = MAX_RETRIES } = this._options;
			if (this._retries >= retries) {
				console.log(`Terminated: Max retries reached (${retries})`);
				this._state = ConnectionState.TERMINATED;
				if (this._ws) {
					this._ws.onopen = void 0;
					this._ws.onmessage = void 0;
					this._ws.onclose = void 0;
					this._ws.onerror = void 0;
					this._ws = void 0;
				}
				return true;
			}
			return false;
		}
		on_connecting() {
			const { debug = false } = this._options;
			if (debug) console.log(`Connecting ${this.url}`);
		}
		on_connect() {
			console.log(`Connect  ${this.url}`);
		}
		on_error(error) {
			const { debug = false } = this._options;
			if (debug) console.log(`Error: ${error}`);
		}
		on_disconnect(event) {
			console.error(`Disconnect ${this.url}`);
		}
		on_message(data) {
			const { debug = false } = this._options;
			if (debug) console.log(`Receive: ${data}`);
		}
		/**
		* Sends raw text data over the WebSocket connection.
		* @internal
		* @param {string} data - Payload string to send
		* @returns {void}
		*/
		send(data) {
			if (this._state === ConnectionState.CONNECTED) try {
				this._ws.send(data);
			} catch (error) {
				console.error(`Send fail: ${error}`);
			}
			else console.log(`Send drop : not connected`);
		}
		/**
		* Returns a Promise that resolves when the WebSocket reaches the {@link ConnectionState ConnectionState.CONNECTED} state.
		* @returns {Promise<void>} Resolves upon successful connection
		*/
		connectedPromise() {
			const [promise, resolver] = resolvablePromise();
			if (this._state === ConnectionState.CONNECTED) resolver();
			else this._connect_promise_resolvers.push(resolver);
			return promise;
		}
		/**
		* Closes the WebSocket connection and marks state as TERMINATED (disables auto-reconnect).
		* @internal
		* @returns {void}
		*/
		close() {
			this._retries = 5;
			this._state = ConnectionState.TERMINATED;
			if (this._ws) this._ws.close();
		}
		/**
		* Triggers a manual connection reset and reconnect.
		* @param {Object} [options] - Configuration options
		* @param {boolean} [options.immediate=true] - Whether to reconnect immediately or after a 1s delay
		* @returns {void}
		*/
		reconnect(options = {}) {
			const { immediate = true } = options;
			if (this._ws) {
				this._ws.onopen = null;
				this._ws.onmessage = null;
				this._ws.onclose = null;
				this._ws.onerror = null;
				try {
					this._ws.close();
				} catch (e) {}
				this._ws = void 0;
			}
			this._state = ConnectionState.DISCONNECTED;
			this._retries = 0;
			this.on_disconnect({ reason: "reconnect" });
			if (immediate) this.connect();
			else setTimeout(() => this.connect(), 1e3);
		}
	};
	//#endregion
	//#region client/common.js
	/**
	* Message types used in client-server communication.
	*/
	var MsgType = {
		REQUEST: "REQUEST",
		REPLY: "REPLY",
		MESSAGE: "MESSAGE"
	};
	/**
	* Message command verbs used in requests and notifications.
	*/
	var MsgCmd = {
		GET: "GET",
		PUT: "PUT",
		NOTIFY: "NOTIFY"
	};
	/**
	* Normalizes a path string to ensure a leading slash.
	* @param {string} rawPath
	* @returns {string} Normalized path
	*/
	function normalizePath(rawPath) {
		if (!rawPath || typeof rawPath !== "string") return "";
		return rawPath.startsWith("/") ? rawPath : "/" + rawPath;
	}
	/**
	* Validates that a path string is a valid 3-segment resource path (/app/store/resource).
	* @param {string} rawPath
	* @returns {string} Clean normalized 3-segment path
	*/
	function validatePath(rawPath) {
		if (!rawPath || typeof rawPath !== "string") throw new Error("Path must be a valid non-empty string.");
		const normPath = normalizePath(rawPath);
		if (normPath.split("/").filter(Boolean).length !== 3) throw new Error(`Invalid path '${rawPath}'. Path must have exactly 3 segments (e.g. /app/store/res).`);
		return normPath;
	}
	/**
	* Ensures an item object adheres to canonical structure with a valid id string.
	* @param {*} rawItem
	* @returns {Object}
	*/
	function sanitizeItem(rawItem) {
		if (!rawItem || typeof rawItem !== "object") return {
			id: "",
			state: null
		};
		const id = String(rawItem.id ?? "");
		return {
			...rawItem,
			id
		};
	}
	/**
	* Sanitizes any changes payload (arrays, Sets, Maps, or objects) into canonical runtime format:
	* { insert: Map(id -> item), remove: Set(id), reset: boolean, version?: number }
	* @param {Object} rawChanges
	* @returns {Changes}
	*/
	function sanitizeChanges(rawChanges) {
		if (!rawChanges || typeof rawChanges !== "object") return {
			insert: /* @__PURE__ */ new Map(),
			remove: /* @__PURE__ */ new Set(),
			reset: false
		};
		const reset = Boolean(rawChanges.reset);
		const remove = /* @__PURE__ */ new Set();
		const insert = /* @__PURE__ */ new Map();
		if (rawChanges.remove instanceof Set) for (const id of rawChanges.remove) remove.add(String(id));
		else if (Array.isArray(rawChanges.remove)) for (const id of rawChanges.remove) remove.add(String(id));
		if (rawChanges.insert instanceof Map) for (const [key, item] of rawChanges.insert.entries()) {
			const sanitized = sanitizeItem(item);
			const id = sanitized.id || String(key || "");
			insert.set(id, {
				...sanitized,
				id
			});
		}
		else if (Array.isArray(rawChanges.insert)) {
			let idx = 0;
			for (const item of rawChanges.insert) {
				const sanitized = sanitizeItem(item);
				const id = sanitized.id || "";
				const key = id || `__pending_${idx++}`;
				insert.set(key, {
					...sanitized,
					id
				});
			}
		}
		const result = {
			insert,
			remove,
			reset
		};
		if (rawChanges.version !== void 0) result.version = rawChanges.version;
		if (rawChanges.last_version !== void 0) result.last_version = rawChanges.last_version;
		return result;
	}
	/**
	* Serializes runtime Map/Set changes back to wire JSON format for WebSocket transmission:
	* { insert: Array, remove: Array, reset: boolean, version?: number }
	* @param {Object} changes
	* @returns {Object}
	*/
	function serializeChanges(changes) {
		if (!changes || typeof changes !== "object") return changes;
		const reset = Boolean(changes.reset);
		const remove = changes.remove instanceof Set ? Array.from(changes.remove) : Array.isArray(changes.remove) ? changes.remove : [];
		const result = {
			insert: changes.insert instanceof Map ? Array.from(changes.insert.values()) : Array.isArray(changes.insert) ? changes.insert : [],
			remove,
			reset
		};
		if (changes.version !== void 0) result.version = changes.version;
		if (changes.last_version !== void 0) result.last_version = changes.last_version;
		return result;
	}
	//#endregion
	//#region client/providers/item_provider.js
	var UpdateBuilder = class {
		constructor(proxyCollection) {
			this._proxyCollection = proxyCollection;
			this._pendingInserts = /* @__PURE__ */ new Map();
			this._pendingRemoves = /* @__PURE__ */ new Set();
			this._pendingReset = false;
			this._pendingConditional = false;
			this._scheduled = false;
			this._sharedPromise = null;
			this._sharedResolver = null;
		}
		add_change(rawChanges = {}, options = {}) {
			const { insert, remove, reset } = sanitizeChanges(rawChanges);
			if (Boolean(rawChanges.dropIfModified || rawChanges.ifUnmodified || rawChanges.conditional || options.dropIfModified || options.ifUnmodified || options.conditional)) this._pendingConditional = true;
			if (reset) {
				this._pendingInserts.clear();
				this._pendingRemoves.clear();
				this._pendingReset = true;
			}
			if (remove.size > 0) for (const id of remove) {
				this._pendingInserts.delete(id);
				this._pendingRemoves.add(id);
			}
			if (insert.size > 0) for (let [key, item] of insert.entries()) {
				let id = item.id;
				if (!id) {
					id = random_string(10);
					item = {
						...item,
						id
					};
				}
				this._pendingRemoves.delete(id);
				this._pendingInserts.set(id, item);
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
			this._pendingInserts = /* @__PURE__ */ new Map();
			this._pendingRemoves = /* @__PURE__ */ new Set();
			this._pendingReset = false;
			this._pendingConditional = false;
			this._scheduled = false;
			this._sharedPromise = null;
			this._sharedResolver = null;
			const payload = serializeChanges({
				insert: pendingInserts,
				remove: pendingRemoves,
				reset
			});
			if (isConditional) payload.last_version = this._proxyCollection._version;
			try {
				resolver(await this._proxyCollection._client._update(this._proxyCollection._path, payload));
			} catch (err) {
				resolver({
					ok: false,
					error: err
				});
			}
		}
	};
	/**
	* ItemProvider manages state replication, key-value item mapping, and update synchronization for a path.
	* @class ItemProvider
	* @implements {CollectionResource}
	*/
	var ItemProvider = class {
		constructor(client, path) {
			this._terminated = false;
			this._client = client;
			this._path = path;
			this._handlers = [];
			this._map = /* @__PURE__ */ new Map();
			this._version = 0;
			this._builder = new UpdateBuilder(this);
		}
		/*********************************************************
		APPLICATION API
		**********************************************************/
		get path() {
			return this._path;
		}
		get size() {
			return this._map.size;
		}
		get optimistic() {
			return false;
		}
		get provider() {
			return this;
		}
		has_item(id) {
			return this._map.has(id);
		}
		get_item(id) {
			return this._map.get(id);
		}
		get_items() {
			return [...this._map.values()];
		}
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
			if (this._terminated) throw new Error("collection already terminated");
			return this._builder.add_change(changes, options);
		}
		/**
		* application register callback
		*/
		add_callback(handler) {
			const handle = { handler };
			this._handlers.push(handle);
			return handle;
		}
		remove_callback(handle) {
			const index = this._handlers.indexOf(handle);
			if (index > -1) this._handlers.splice(index, 1);
		}
		/*********************************************************
		SHARED STATE CLIENT API
		**********************************************************/
		/**
		* Collection released by ss client
		*/
		_client_terminate() {
			this._terminated = true;
			this._handlers = [];
		}
		/**
		* server update collection 
		*/
		_client_update(changes = {}, tunnel = null) {
			if (this._terminated) throw new Error("collection already terminated");
			const incomingVersion = changes.version;
			if (changes && changes.reset) {
				if (incomingVersion !== void 0) this._version = incomingVersion;
			} else if (incomingVersion !== void 0 && this._version !== void 0) {
				if (incomingVersion > this._version + 1) {
					console.warn(`Version gap detected on '${this._path}': local version ${this._version}, incoming version ${incomingVersion}. Triggering immediate reconnect.`);
					this._client._reconnect("version_gap");
					return;
				}
				if (incomingVersion <= this._version) return;
				this._version = incomingVersion;
			}
			const { remove, insert, reset } = sanitizeChanges(changes);
			const eff_remove = /* @__PURE__ */ new Set();
			const eff_insert = /* @__PURE__ */ new Map();
			if (reset) {
				for (const id of this._map.keys()) eff_remove.add(id);
				this._map = /* @__PURE__ */ new Map();
			} else for (const _id of remove) if (this._map.has(_id)) {
				this._map.delete(_id);
				eff_remove.add(_id);
			}
			for (const [id, item] of insert.entries()) {
				this._map.set(id, item);
				eff_insert.set(id, item);
			}
			const effective_changes = {
				remove: eff_remove,
				insert: eff_insert,
				reset,
				version: this._version
			};
			this._notify_callbacks(effective_changes);
		}
		_notify_callbacks(eArg) {
			this._handlers.forEach(function(handle) {
				handle.handler(eArg);
			});
		}
	};
	//#endregion
	//#region client/providers/optimistic_item_provider.js
	/**
	* OptimisticItemProvider decorates an ItemProvider with optimistic local state overlays.
	* @class OptimisticItemProvider
	* @implements {CollectionResource}
	*/
	var OptimisticItemProvider = class {
		constructor(client, itemProvider) {
			this._client = client;
			this._itemProvider = itemProvider;
			this._proxyCollection = itemProvider;
			this._path = itemProvider._path;
			this._terminated = false;
			this._overlay = /* @__PURE__ */ new Map();
			this._last_acked_update_count = 0;
			this._handlers = [];
		}
		get path() {
			return this._path;
		}
		get size() {
			this._cleanup_expired();
			let count = this._proxyCollection.size;
			for (const [id, entry] of this._overlay.entries()) if (entry.is_delete) {
				if (this._proxyCollection.has_item(id)) count--;
			} else if (!this._proxyCollection.has_item(id)) count++;
			return count;
		}
		get optimistic() {
			return true;
		}
		get provider() {
			return this;
		}
		has_item(id) {
			this._cleanup_expired();
			if (this._overlay.has(id)) return !this._overlay.get(id).is_delete;
			return this._proxyCollection.has_item(id);
		}
		get_item(id) {
			this._cleanup_expired();
			if (this._overlay.has(id)) {
				const entry = this._overlay.get(id);
				return entry.is_delete ? void 0 : entry.item;
			}
			return this._proxyCollection.get_item(id);
		}
		get_items() {
			this._cleanup_expired();
			const baseItems = this._proxyCollection.get_items();
			const map = /* @__PURE__ */ new Map();
			for (const item of baseItems) map.set(item.id, item);
			for (const [id, entry] of this._overlay.entries()) if (entry.is_delete) map.delete(id);
			else map.set(id, entry.item);
			return Array.from(map.values());
		}
		_cleanup_expired() {
			const failureTimeout = this._client && this._client._options && this._client._options.failureTimeout || 10;
			if (failureTimeout <= 0) return;
			const now = Date.now();
			const timeoutMs = failureTimeout * 1e3;
			for (const [id, entry] of this._overlay.entries()) if (now - entry.timestamp > timeoutMs) this._overlay.delete(id);
		}
		_client_terminate() {
			this._terminated = true;
			this._handlers = [];
			this._overlay.clear();
			this._proxyCollection._client_terminate();
		}
		_client_ack(update_count, ok) {
			if (this._terminated) return;
			const stateBefore = this._get_visible_state_map();
			if (typeof update_count === "number" && update_count > 0) {
				this._last_acked_update_count = Math.max(this._last_acked_update_count, update_count);
				for (const [id, entry] of this._overlay.entries()) if (entry.update_count <= this._last_acked_update_count) this._overlay.delete(id);
			}
			const stateAfter = this._get_visible_state_map();
			const effectiveChanges = this._compute_diff(stateBefore, stateAfter, {}, null);
			if (effectiveChanges.reset || effectiveChanges.insert.size > 0 || effectiveChanges.remove.size > 0) this._notify_callbacks(effectiveChanges);
		}
		_client_update(changes = {}, tunnel = null) {
			if (this._terminated) throw new Error("collection already terminated");
			const stateBefore = this._get_visible_state_map();
			if (tunnel && tunnel.client_id === this._client.id) {
				if (typeof tunnel.update_count === "number") {
					this._last_acked_update_count = tunnel.update_count;
					for (const [id, entry] of this._overlay.entries()) if (entry.update_count <= this._last_acked_update_count) this._overlay.delete(id);
				}
			}
			if (changes && changes.reset === true) this._overlay.clear();
			this._proxyCollection._client_update(changes, tunnel);
			const stateAfter = this._get_visible_state_map();
			const effectiveChanges = this._compute_diff(stateBefore, stateAfter, changes, tunnel);
			if (effectiveChanges.reset || effectiveChanges.insert.size > 0 || effectiveChanges.remove.size > 0) this._notify_callbacks(effectiveChanges);
		}
		/**
		* Updates items stored in the path resource across the network.
		* @param {Object} [changes={}] - Delta changes object `{ insert, remove, reset }`
		* @param {Object} [options={}] - Update options
		* @returns {Promise<Object>} Resolves when state update is dispatched/processed
		*/
		update_items(changes = {}, options = {}) {
			return this._update_items(changes, options);
		}
		_update_items(changes = {}, options = {}) {
			if (this._terminated) throw new Error("collection already terminated");
			const { insert, remove, reset } = sanitizeChanges(changes);
			for (const [id, item] of insert.entries()) if (!id) {
				const newId = random_string(10);
				insert.delete(id);
				insert.set(newId, {
					...item,
					id: newId
				});
			}
			const promise = this._proxyCollection._update_items({
				insert,
				remove,
				reset
			}, options);
			const currentUpdateCount = ++this._client._update_count;
			const timestamp = Date.now();
			queueMicrotask(() => {
				const stateBefore = this._get_visible_state_map();
				if (reset) this._overlay.clear();
				for (const id of remove) this._overlay.set(id, {
					item: null,
					update_count: currentUpdateCount,
					is_delete: true,
					timestamp
				});
				for (const [id, item] of insert.entries()) this._overlay.set(id, {
					item,
					update_count: currentUpdateCount,
					is_delete: false,
					timestamp
				});
				const stateAfter = this._get_visible_state_map();
				const effectiveChanges = this._compute_diff(stateBefore, stateAfter, { reset }, null);
				if (effectiveChanges.reset || effectiveChanges.insert.size > 0 || effectiveChanges.remove.size > 0) this._notify_callbacks(effectiveChanges);
			});
			return promise;
		}
		_get_visible_state_map() {
			const visibleMap = /* @__PURE__ */ new Map();
			for (const item of this._proxyCollection.get_items()) visibleMap.set(item.id, item);
			for (const [id, entry] of this._overlay.entries()) if (entry.is_delete) visibleMap.delete(id);
			else visibleMap.set(id, entry.item);
			return visibleMap;
		}
		_compute_diff(stateBefore, stateAfter, baseChanges = {}, tunnel = null) {
			const effInsert = /* @__PURE__ */ new Map();
			const effRemove = /* @__PURE__ */ new Set();
			if (baseChanges.reset) {
				for (const [id, item] of stateAfter.entries()) effInsert.set(id, item);
				return {
					insert: effInsert,
					remove: new Set(stateBefore.keys()),
					reset: true,
					version: this._proxyCollection._version
				};
			}
			for (const [id, afterItem] of stateAfter.entries()) {
				const beforeItem = stateBefore.get(id);
				if (!beforeItem || JSON.stringify(beforeItem) !== JSON.stringify(afterItem)) effInsert.set(id, afterItem);
			}
			for (const id of stateBefore.keys()) if (!stateAfter.has(id)) effRemove.add(id);
			return {
				insert: effInsert,
				remove: effRemove,
				reset: false,
				version: this._proxyCollection._version
			};
		}
		add_callback(handler) {
			const handle = { handler };
			this._handlers.push(handle);
			return handle;
		}
		remove_callback(handle) {
			const index = this._handlers.indexOf(handle);
			if (index > -1) this._handlers.splice(index, 1);
		}
		_notify_callbacks(eArg) {
			this._handlers.forEach(function(handle) {
				handle.handler(eArg);
			});
		}
	};
	//#endregion
	//#region client/providers/single_item_provider.js
	/**
	* Concrete provider representing a single item bound within a PathResource.
	* Implements ItemResource.
	* @class SingleItemProvider
	*/
	var SingleItemProvider = class {
		/**
		* @param {Object} provider - Parent PathResource (ItemProvider or OptimisticItemProvider)
		* @param {string} name - Target item identifier/name
		*/
		constructor(provider, name) {
			this._provider = provider;
			this._name = name;
		}
		/**
		* Target item identifier name.
		* @type {string}
		* @readonly
		*/
		get name() {
			return this._name;
		}
		/**
		* Underlying PathResource (Layer 1 state provider).
		* @type {Object}
		* @readonly
		*/
		get provider() {
			return this._provider;
		}
		/**
		* Retrieves the current state/value of the item.
		* @returns {*} Associated item state, or `undefined` if item is uninitialized
		*/
		get() {
			const item = this._provider.get_item(this._name);
			if (!item) return void 0;
			return item.state !== void 0 ? item.state : item.value;
		}
		/**
		* Checks whether the item has been initialized in provider state.
		* @returns {boolean} `true` if item is initialized, `false` otherwise
		*/
		is_initialized() {
			return this._provider.has_item(this._name);
		}
		/**
		* Updates the item value across the network.
		* @param {*} value - New item state value
		* @param {Object} [options] - Update options
		* @returns {Promise<Object>} Resolves when state update is dispatched/processed
		*/
		set(value, options = {}) {
			return this._provider.update_items({ insert: [{
				id: this._name,
				state: value
			}] }, options);
		}
		/**
		* Registers a callback invoked whenever this specific item is updated or reset.
		* @param {Function} handler - Callback receiving value change `{ new: *, old: * }`
		* @returns {Object} Subscription handle with `.remove_callback()` and `.off()` methods
		*/
		add_callback(handler) {
			let oldValue = this.get();
			const wrappedHandler = (changes) => {
				const { insert, remove, reset } = changes;
				if (reset || remove && remove.has(this._name) || insert && insert.has(this._name)) {
					const newValue = this.get();
					const diff = {
						new: newValue,
						old: oldValue
					};
					oldValue = newValue;
					handler(diff);
				}
			};
			const handle = this._provider.add_callback(wrappedHandler);
			return {
				handle,
				remove_callback: () => this._provider.remove_callback(handle),
				off: () => this._provider.remove_callback(handle)
			};
		}
		/**
		* Removes a registered callback.
		* @param {Object} handle - Subscription handle returned from add_callback
		*/
		remove_callback(handle) {
			const targetHandle = handle && handle.handle ? handle.handle : handle;
			this._provider.remove_callback(targetHandle);
		}
	};
	//#endregion
	//#region client/server_clock.js
	var local = { now: function() {
		return performance.now() / 1e3;
	} };
	var epoch = { now: function() {
		if (typeof performance !== "undefined" && typeof performance.timeOrigin === "number") return (performance.timeOrigin + performance.now()) / 1e3;
		return /* @__PURE__ */ new Date() / 1e3;
	} };
	/**
	* CLOCK gives epoch values, but is implemented
	* using performance now for better
	* time resolution and protection against system 
	* time adjustments.
	*/
	var CLOCK = function() {
		const t0_local = local.now();
		const t0_epoch = epoch.now();
		return { now: function() {
			const t1_local = local.now();
			return t0_epoch + (t1_local - t0_local);
		} };
	}();
	/**
	* Estimate the clock of the server 
	*/
	var MAX_SAMPLE_COUNT = 30;
	/**
	* Approximates server clock by sampling server time and network latency.
	* All time measurements are in seconds with sub millisecond precision.
	* @class ServerClock
	*/
	var ServerClock = class {
		/**
		* Initializes a ServerClock instance.
		* @internal
		* @param {SharedStateClient} client - SharedState client instance
		*/
		constructor(client) {
			this._client = client;
			this._pinger = new Pinger(this._onping.bind(this));
			this._samples = [];
			this._trans = 1e3;
			this._skew = 0;
			this._latest_trans = void 0;
			this._latest_skew = void 0;
		}
		/**
		* Underlying Pinger instance.
		* @type {Object}
		* @internal
		* @readonly
		*/
		get pinger() {
			return this._pinger;
		}
		/**
		* Restarts clock synchronization sampling.
		* @internal
		* @returns {void}
		*/
		restart() {
			this._samples = [];
			this._trans = 1e3;
			this._skew = 0;
			this._latest_trans = void 0;
			this._latest_skew = void 0;
			this._pinger.restart();
		}
		_onping() {
			const ts0 = CLOCK.now();
			(this._client._get ? this._client._get("/clock") : this._client.get("/clock")).then(({ ok, data }) => {
				if (ok) {
					const ts1 = CLOCK.now();
					this._add_sample(ts0, data, ts1);
				}
			});
		}
		_add_sample(cs, ss, cr) {
			let trans = (cr - cs) / 2;
			let skew = ss - (cr + cs) / 2;
			this._latest_trans = trans;
			this._latest_skew = skew;
			let sample = [
				cs,
				ss,
				cr,
				trans,
				skew
			];
			this._samples.push(sample);
			if (this._samples.length > MAX_SAMPLE_COUNT) this._samples.shift();
			trans = 1e5;
			skew = 0;
			for (const sample of this._samples) if (sample[3] < trans) {
				trans = sample[3];
				skew = sample[4];
			}
			this._skew = skew;
			this._trans = trans;
		}
		/**
		* Clock skew estimate (in seconds) relative to server clock (`server clock == local clock + skew`).
		* @type {number}
		* @readonly
		*/
		get skew() {
			return this._skew;
		}
		/**
		* Latest skew estimate in seconds.
		* @type {number}
		* @readonly
		*/
		get last_skew() {
			return this._latest_skew !== void 0 ? this._latest_skew : this._skew;
		}
		/**
		* Estimated round trip time (RTT) in seconds.
		* @type {number}
		* @readonly
		*/
		get rtt() {
			return this._trans * 2;
		}
		/**
		* Latest round trip time (RTT) measurment in seconds.
		* @type {number}
		* @readonly
		*/
		get last_rtt() {
			return (this._latest_trans !== void 0 ? this._latest_trans : this._trans) * 2;
		}
		/**
		* Standard deviation of clock skew across current samples in seconds.
		* @type {number}
		* @readonly
		*/
		get skew_std() {
			if (this._samples.length === 0) return 0;
			const vals = this._samples.map((s) => s[4]);
			const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
			const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
			return Math.sqrt(variance);
		}
		/**
		* Standard deviation of round trip time (RTT) across current samples in seconds.
		* @type {number}
		* @readonly
		*/
		get rtt_std() {
			if (this._samples.length === 0) return 0;
			const vals = this._samples.map((s) => s[3] * 2);
			const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
			const variance = vals.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / vals.length;
			return Math.sqrt(variance);
		}
		/**
		* Clock skew range (max - min) across current samples in seconds.
		* @type {number}
		* @readonly
		*/
		get skew_range() {
			if (this._samples.length === 0) return 0;
			const vals = this._samples.map((s) => s[4]);
			return Math.max(...vals) - Math.min(...vals);
		}
		/**
		* Round trip time (RTT) range (max - min) across current samples in seconds.
		* @type {number}
		* @readonly
		*/
		get rtt_range() {
			if (this._samples.length === 0) return 0;
			const vals = this._samples.map((s) => s[3] * 2);
			return Math.max(...vals) - Math.min(...vals);
		}
		/**
		* Returns current estimated server time in seconds (after epoch).
		* @returns {number} Current estimated server timestamp in seconds
		*/
		now() {
			return CLOCK.now() + this._skew;
		}
	};
	/*********************************************************
	PINGER
	**********************************************************/
	/**
	* Pinger invokes a callback repeatedly, indefinitely. 
	* Pinging in 3 stages, first frequently, then moderately, 
	* then slowly.
	*/
	var SMALL_DELAY = 20;
	var MEDIUM_DELAY = 500;
	var LARGE_DELAY = 1e3;
	var DELAY_SEQUENCE = [
		...new Array(3).fill(SMALL_DELAY),
		...new Array(7).fill(MEDIUM_DELAY),
		...[LARGE_DELAY]
	];
	var Pinger = class {
		constructor(callback) {
			this._count = 0;
			this._tid = void 0;
			this._callback = callback;
			this._ping = this.ping.bind(this);
			this._delays = [...DELAY_SEQUENCE];
		}
		pause() {
			clearTimeout(this._tid);
		}
		resume() {
			clearTimeout(this._tid);
			this.ping();
		}
		restart() {
			this._delays = [...DELAY_SEQUENCE];
			clearTimeout(this._tid);
			this.ping();
		}
		ping() {
			let next_delay = this._delays[0];
			if (this._delays.length > 1) this._delays.shift();
			if (this._callback) this._callback();
			this._tid = setTimeout(this._ping, next_delay);
		}
	};
	//#endregion
	//#region client/client.js
	var DEFAULT_FAILURE_TIMEOUT = 10;
	/**
	* The client library version string.
	* @type {string}
	*/
	var VERSION = "1.0.0";
	/**
	* The `SharedStateClient` manages logical network connections, subscriptions, state providers, and application objects.
	* @class SharedStateClient
	* @see {@link Connection}
	* @see {@link ServerClock}
	* @see {@link CollectionResource}
	* @see {@link ValueResource}
	* @see {@link TokenAccess Token-based Resource Access}
	*/
	var SharedStateClient = class {
		/**
		* The client library version string.
		* @type {string}
		*/
		static VERSION = VERSION;
		/**
		* Initializes the SharedStateClient.
		* @param {string} url - WebSocket server URL (ws://host:port/)
		* @param {Object} [options] - Configuration options
		* @param {number} [options.failureTimeout=10] - Time in seconds before unacknowledged updates trigger a reconnect
		*/
		constructor(url, options = {}) {
			if (!isNumber(options.failureTimeout)) options.failureTimeout = DEFAULT_FAILURE_TIMEOUT;
			this._options = options;
			this._client_id = random_string(12);
			this._request_count = 0;
			this._update_count = 0;
			this._last_acked_update_count = 0;
			this._pending_requests = /* @__PURE__ */ new Map();
			this._pending_updates = /* @__PURE__ */ new Map();
			this._subscriptions = /* @__PURE__ */ new Map();
			this._sub_scheduled = false;
			this._providers = /* @__PURE__ */ new Map();
			this._path_bindings = /* @__PURE__ */ new Map();
			this._item_bindings = /* @__PURE__ */ new Map();
			this._serverclock = new ServerClock(this);
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
			if (!token || typeof token !== "string") throw new Error("Token must be a non-empty string.");
			path = validatePath(path);
			const existingPathToken = this._path_bindings.get(path);
			if (existingPathToken !== void 0 && existingPathToken !== token) throw new Error(`Path '${path}' is already bound to token '${existingPathToken}' (path-exclusive)`);
			const itemMap = this._item_bindings.get(path);
			if (itemMap && itemMap.size > 0) throw new Error(`Path '${path}' already has item-exclusive bindings; cannot bind path-exclusively`);
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
			if (!token || typeof token !== "string") throw new Error("Token must be a non-empty string.");
			if (!name || typeof name !== "string") throw new Error("name must be a non-empty string.");
			path = validatePath(path);
			const existingPathToken = this._path_bindings.get(path);
			if (existingPathToken !== void 0) throw new Error(`Path '${path}' is already bound to token '${existingPathToken}' (path-exclusive)`);
			let itemMap = this._item_bindings.get(path);
			if (itemMap) {
				const existingItemToken = itemMap.get(name);
				if (existingItemToken !== void 0 && existingItemToken !== token) throw new Error(`Path '${path}' item '${name}' is already bound to token '${existingItemToken}'`);
				itemMap.set(name, token);
			} else {
				itemMap = /* @__PURE__ */ new Map([[name, token]]);
				this._item_bindings.set(path, itemMap);
			}
			if (!this._providers.has(path)) {
				const baseProvider = new ItemProvider(this, path);
				const providerInstance = new OptimisticItemProvider(this, baseProvider);
				this._providers.set(path, providerInstance);
			}
			this._subscriptions.set(path, {});
			this._schedule_sub_sync();
			return new SingleItemProvider(this._providers.get(path), name);
		}
		/**
		* Terminates the client: releases all providers, subscriptions, bindings, and closes the WebSocket connection.
		* @returns {undefined}
		*/
		terminate() {
			for (const [path, providerInstance] of this._providers.entries()) {
				this._subscriptions.delete(path);
				if (providerInstance !== void 0) providerInstance._client_terminate();
			}
			this._providers.clear();
			this._path_bindings.clear();
			this._item_bindings.clear();
			this._subscriptions.clear();
			if (this._connection) this._connection.close();
		}
		/************************************************
		*  CONNECTION
		************************************************/
		/** Called automatically when WebSocket connects/reconnects. */
		_on_connect() {
			if (this._serverclock) this._serverclock.restart();
			this._schedule_sub_sync();
		}
		/** Rejects pending request promises on disconnect. */
		_on_disconnect(event) {
			if (this._serverclock && this._serverclock.pinger) this._serverclock.pinger.pause();
			for (const resolver of this._pending_requests.values()) resolver({
				ok: false,
				data: "connection disconnected"
			});
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
			if (msg.path) msg.path = normalizePath(msg.path);
			if (!msg.tunnel || typeof msg.tunnel !== "object") msg.tunnel = {};
			if (msg.type === MsgType.REPLY) this._handle_reply(msg);
			else if (msg.type === MsgType.MESSAGE || msg.cmd === MsgCmd.NOTIFY) this._handle_notify(msg);
		}
		/** Resolves pending request promise matching request_count. */
		_handle_reply(msg) {
			const request_count = msg.tunnel.request_count;
			if (request_count !== void 0 && this._pending_requests.has(request_count)) {
				const resolver = this._pending_requests.get(request_count);
				this._pending_requests.delete(request_count);
				const { ok, data } = msg;
				resolver({
					ok,
					data
				});
			}
			const update_count = msg.tunnel.update_count;
			if (update_count !== void 0) this._on_ack(update_count, msg.ok !== false, msg.path);
		}
		/** Passes server updates to target ProxyCollection provider. */
		_handle_notify(msg) {
			const update_count = msg.tunnel.update_count;
			if (update_count !== void 0) this._on_ack(update_count, true, msg.path);
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
			const [promise, resolver] = resolvablePromise();
			this._pending_requests.set(request_count, resolver);
			return promise.then(({ ok, data }) => {
				if (cmd === MsgCmd.PUT && path === "/subs" && ok) this._subscriptions = new Map(data);
				return {
					ok,
					path,
					data
				};
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
			if (this._connection.state !== ConnectionState.CONNECTED) return;
			const payload = {
				insert: Array.from(this._subscriptions.entries()),
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
			if (updateCount > this._last_acked_update_count + 1) {
				for (const [count] of this._pending_updates.entries()) if (count < updateCount) {
					this._reconnect("ack_gap");
					break;
				}
			}
			this._pending_updates.delete(updateCount);
			this._last_acked_update_count = Math.max(this._last_acked_update_count, updateCount);
			if (path && this._providers.has(path)) {
				const providerInstance = this._providers.get(path);
				if (typeof providerInstance._client_ack === "function") providerInstance._client_ack(updateCount, ok);
			}
			this._check_pending_timeouts();
		}
		/** Checks if the oldest pending update exceeds failureTimeout, triggering reconnect if CONNECTED. */
		_check_pending_timeouts() {
			if (this._pending_updates.size === 0) return;
			let oldestCount = null;
			let oldestTs = Infinity;
			for (const [count, entry] of this._pending_updates.entries()) if (entry.timestamp < oldestTs) {
				oldestTs = entry.timestamp;
				oldestCount = count;
			}
			if (oldestCount !== null && Date.now() - oldestTs > this._options.failureTimeout * 1e3) this._reconnect("timeout");
		}
		/** Triggers immediate WebSocket reconnection when self-healing, ACK gaps, or version gaps occur. */
		_reconnect(reason = "unknown") {
			console.warn(`Reconnect (reason: ${reason})`);
			if (this._connection && this._connection.state === ConnectionState.CONNECTED) this._connection.reconnect({ immediate: true });
		}
	};
	//#endregion
	//#region client/util/events.js
	/**
	* The `eventify` decorator can be used on objects or class prototype objects in order to imbue the target object with event capabilities.
	* @module Events
	*/
	/**
	* Callback function signature invoked when an event is emitted.
	* Handlers default to having `this` bound to the event source instance.
	* 
	* @callback handler
	* @param {*} eArg - Event payload data (e.g. variable value or delta change object)
	* @param {EventInfo} eInfo - Event metadata object detailing source, count, and init status
	*/
	/**
	* Optional method implemented by stateful event sources to provide state snapshots for initial state events.
	* 
	* This method is not provided by the decorator, and must therefore be manually implemented.
	* 
	* If implemented, `get_current_state(name)` returns the current state snapshot for the given event `name`.
	* If it returns `null`, initial state event delivery (`options.init = true`) is deferred until the first `emit(name, ...)` call occurs.
	* If not implemented, subscribing with `options.init = true` delivers an initial event with `eArg = undefined`.
	* 
	* @function get_current_state
	* @param {string} name - Event name string
	* @returns {*|null} Current state for given event name, or null if uninitialized
	*/
	/**
	* Event info passed as second parameter (`eInfo`) to event callbacks.
	* @typedef {Object} EventInfo
	* @property {Object} src - Object emitting the event
	* @property {string} name - Event name string (e.g. "change")
	* @property {number} count - Total times this event handler has been invoked
	* @property {boolean} init - True if this is an initial state event (count === 1)
	* @property {Object} handle - Subscription handle object (supports `.off()`)
	*/
	var Subscription = class {
		constructor(eventTarget, name, callback, options = {}) {
			this.target = eventTarget;
			this.name = name;
			this.callback = callback;
			this.options = options;
			this.count = 0;
			this.terminated = false;
			this.initPending = false;
		}
		off() {
			if (this.terminated) return;
			this.terminated = true;
			if (this.target && typeof this.target.off === "function") this.target.off(this);
		}
		unsubscribe() {
			this.off();
		}
	};
	var EventManager = class {
		constructor(target) {
			this.target = target;
			this.subscriptions = /* @__PURE__ */ new Map();
			this.emitBuffer = [];
			this.flushScheduled = false;
		}
		getEventSubscriptions(name) {
			let subs = this.subscriptions.get(name);
			if (!subs) {
				subs = [];
				this.subscriptions.set(name, subs);
			}
			return subs;
		}
		/**
		* Register an event handler for a named event.
		* @param {string} name - Event name (e.g. "change")
		* @param {handler} handler - Callback function invoked when event is emitted.
		* @param {Object} [options] - Subscription options
		* @param {boolean} [options.init=false] - If true, requests immediate event delivery upon subscription
		* @returns {Object} Subscription handle object (supports `.off()`)
		*/
		on(name, callback, options = {}) {
			if (typeof callback !== "function") throw new TypeError(`Callback must be a function, got ${typeof callback}`);
			const subs = this.getEventSubscriptions(name);
			const existing = subs.find((s) => !s.terminated && s.callback === callback);
			if (existing) return existing;
			const sub = new Subscription(this.target, name, callback, options);
			subs.push(sub);
			if (options.init === true) if (!(typeof this.target.get_current_state === "function")) {
				sub.initPending = true;
				Promise.resolve().then(() => {
					if (sub.terminated || !sub.initPending) return;
					sub.initPending = false;
					this._deliver(sub, void 0);
				});
			} else {
				const currentState = this.target.get_current_state(name);
				if (currentState !== null) {
					sub.initPending = true;
					Promise.resolve().then(() => {
						if (sub.terminated || !sub.initPending) return;
						sub.initPending = false;
						const stateAtExec = typeof this.target.get_current_state === "function" ? this.target.get_current_state(name) : currentState;
						this._deliver(sub, stateAtExec);
					});
				} else sub.initPending = true;
			}
			return sub;
		}
		/**
		* Unsubscribes an event handler using the handle object returned by `on()`.
		* @param {Object} handle - Subscription handle object returned by `on()`
		* @returns {void}
		*/
		off(handle) {
			if (!handle || typeof handle !== "object") return;
			handle.terminated = true;
			const subs = this.subscriptions.get(handle.name);
			if (subs) {
				const idx = subs.indexOf(handle);
				if (idx !== -1) subs.splice(idx, 1);
			}
		}
		/**
		* Subscribes an event handler for a single event execution.
		* Automatically unsubscribes after the handler is invoked once.
		* @param {string} name - Event name
		* @param {handler} handler - Callback function invoked once
		* @param {Object} [options] - Subscription options
		* @param {boolean} [options.init=false] - If true, requests immediate event delivery upon subscription
		* @returns {Object} Subscription handle object (supports `.off()`)
		*/
		once(name, callback, options = {}) {
			let handle;
			const wrapper = (eArg, eInfo) => {
				if (handle) handle.off();
				return callback.call(this.target, eArg, eInfo);
			};
			handle = this.on(name, wrapper, options);
			return handle;
		}
		/**
		* Emits an event with the specified name and optional payload argument to subscribed handlers.
		* 
		* @param {string} name - Event name string (e.g. "change")
		* @param {*} [eArg] - Optional event payload data delivered to handlers
		* @returns {void}
		*/
		emit(name, eArg = void 0) {
			this.emitBuffer.push({
				name,
				eArg
			});
			if (!this.flushScheduled) {
				this.flushScheduled = true;
				Promise.resolve().then(() => {
					const buffer = this.emitBuffer;
					this.emitBuffer = [];
					this.flushScheduled = false;
					for (const item of buffer) {
						const subs = this.subscriptions.get(item.name);
						if (!subs || subs.length === 0) continue;
						const targetSubs = subs.filter((sub) => !sub.terminated);
						for (const sub of targetSubs) {
							if (sub.terminated) continue;
							sub.initPending = false;
							this._deliver(sub, item.eArg);
						}
					}
				});
			}
		}
		_deliver(sub, eArg) {
			if (sub.terminated) return;
			sub.count++;
			const eInfo = {
				src: this.target,
				name: sub.name,
				count: sub.count,
				handle: sub,
				get init() {
					return this.count === 1;
				}
			};
			try {
				sub.callback.call(this.target, eArg, eInfo);
			} catch (err) {
				console.error(`Error in event handler for "${sub.name}":`, err);
			}
		}
	};
	var MANAGER_KEY = "__events_manager__";
	function getManager(obj) {
		if (!Object.prototype.hasOwnProperty.call(obj, MANAGER_KEY)) Object.defineProperty(obj, MANAGER_KEY, {
			value: new EventManager(obj),
			writable: false,
			configurable: true,
			enumerable: false
		});
		return obj[MANAGER_KEY];
	}
	/**
	* Decorates/enhances an object or class prototype with event capabilities.
	* Can be called on class prototypes (e.g. `eventify(MyClass.prototype)`) or individual instances.
	* 
	* Adds methods: `on`, `off`, `once`, `emit`.
	* 
	* @param {Object} target - The object or prototype to enhance.
	* @returns {Object} The enhanced target object.
	*/
	function eventify(target) {
		if (!target) return target;
		target.on = function(name, callback, options) {
			return getManager(this).on(name, callback, options);
		};
		target.off = function(handle) {
			return getManager(this).off(handle);
		};
		target.once = function(name, callback, options) {
			return getManager(this).once(name, callback, options);
		};
		target.emit = function(name, eArg = void 0) {
			return getManager(this).emit(name, eArg);
		};
		return target;
	}
	//#endregion
	//#region client/base_objects/base_abstraction.js
	/**
	* Base class for all SharedState abstractions (Variables and Collections).
	* Extends objects with path/provider accessors and event handling (`on`, `off`, `once`).
	* Manages per-client singleton instance caching via WeakMap and WeakRef.
	* @class BaseAbstraction
	*/
	var BaseAbstraction = class BaseAbstraction {
		/** @type {WeakMap<Object, Map<string, WeakRef>>} */
		static _path_instances = /* @__PURE__ */ new WeakMap();
		/** @type {WeakMap<Object, Map<string, Map<string, WeakRef>>>} */
		static _item_instances = /* @__PURE__ */ new WeakMap();
		/**
		* Retrieves an active cached instance for a client and path or (path, itemID).
		* @param {Object} client - Target SharedState client
		* @param {string} path - Canonical path
		* @param {string} [itemID] - Target item ID (omit for path-exclusive collections)
		* @returns {BaseAbstraction|null} Active cached instance or null
		*/
		static get_cached_instance(client, path, itemID = void 0) {
			if (!client) return null;
			path = validatePath(path);
			if (itemID === void 0) {
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
							if (itemMap.size === 0) clientMap.delete(path);
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
			if (itemID === void 0) {
				let clientMap = BaseAbstraction._path_instances.get(client);
				if (!clientMap) {
					clientMap = /* @__PURE__ */ new Map();
					BaseAbstraction._path_instances.set(client, clientMap);
				}
				clientMap.set(path, new WeakRef(instance));
			} else {
				let clientMap = BaseAbstraction._item_instances.get(client);
				if (!clientMap) {
					clientMap = /* @__PURE__ */ new Map();
					BaseAbstraction._item_instances.set(client, clientMap);
				}
				let itemMap = clientMap.get(path);
				if (!itemMap) {
					itemMap = /* @__PURE__ */ new Map();
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
		constructor(client, token, path, itemID = void 0, options = {}) {
			if (!client || typeof client.get_collection_resource !== "function" || typeof client.get_value_resource !== "function") throw new Error(`Client must be an instance of SharedStateClient implementing get_collection_resource and get_value_resource.`);
			path = validatePath(path);
			this._client = client;
			this._path = path;
			this._options = options;
			this._token = token;
			if (itemID === void 0) this._resource = client.get_collection_resource(token, path);
			else this._resource = client.get_value_resource(token, path, itemID);
		}
		/**
		* Canonical path of the object's provider.
		* @type {string}
		* @readonly
		*/
		get path() {
			return this._path;
		}
		/**
		* The underlying PathResource (ItemProvider instance).
		* @type {Object}
		* @readonly
		*/
		get provider() {
			return this._resource.provider;
		}
		/**
		* The resource handle (`PathResource` or `ItemResource`).
		* @type {Object}
		* @readonly
		*/
		get resource() {
			return this._resource;
		}
		/**
		* The parent SharedState client instance.
		* @type {SharedStateClient}
		* @readonly
		*/
		get client() {
			return this._client;
		}
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
	};
	eventify(BaseAbstraction.prototype);
	//#endregion
	//#region client/base_objects/base_collection.js
	/**
	* Base class for all SharedState collection types (SharedMap and SharedSet).
	* Extends {@link BaseAbstraction} with collection mutation and change broadcasting.
	* @class BaseCollection
	*/
	var BaseCollection = class extends BaseAbstraction {
		/**
		* Initializes a BaseCollection instance.
		* @param {SharedStateClient} client - The SharedState client instance
		* @param {string} path - Target path prefix for the collection
		* @param {Object} [options] - Configuration options
		* @param {string} [token] - Binding lock token (defaults to constructor name)
		*/
		constructor(client, path, options = {}, token = void 0) {
			path = validatePath(path);
			const cached = BaseAbstraction.get_cached_instance(client, path);
			if (cached) return cached;
			const tok = token || new.target && new.target.name || "BaseCollection";
			super(client, tok, path, void 0, options);
			BaseAbstraction.cache_instance(client, path, void 0, this);
			this._resource.add_callback((changes) => {
				this._on_resource_update(changes);
			});
		}
		/**
		* Removes all elements from the collection.
		* @returns {Promise<void>} Resolves when clear operation completes
		*/
		async clear() {
			return await this._resource.update_items({ reset: true });
		}
		_on_resource_update(changes) {
			this.emit("change", changes);
		}
		get_current_state(name) {
			if (name === "change") {
				const items = this._resource.get_items();
				const insert = new Map(items.map((item) => [item.id, item]));
				return {
					remove: /* @__PURE__ */ new Set(),
					insert,
					reset: true
				};
			}
			return null;
		}
	};
	//#endregion
	//#region client/objects/map.js
	/**
	* Online-hosted key-value store emulating the standard JavaScript `Map` interface.
	* Extends {@link BaseCollection}.
	* 
	* `SharedMap` implements the {@link Events} interface. 
	* All state changes are emitted on the `"change"` event, with {@link Changes changes} as callback payload.
	* @class SharedMap
	*/
	var SharedMap = class extends BaseCollection {
		/**
		* Initializes a SharedMap instance.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Resource [Path](/design/representation/item_collection#path)
		*/
		constructor(client, path) {
			super(client, path, {}, "SharedMap");
		}
		/**
		* Returns the number of key-value entries in the map.
		* @type {number}
		* @readonly
		*/
		get size() {
			return this._resource.size;
		}
		/**
		* Sets a key-value pair.
		* @param {string} key - Key
		* @param {*} value - Value to associate with key
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		async set(key, value) {
			const record = {
				id: key,
				state: value
			};
			return await this._resource.update_items({ insert: [record] });
		}
		/**
		* Removes an entry specified by key from the map.
		* @param {string} key - Key to delete
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		async delete(key) {
			return await this._resource.update_items({ remove: [key] });
		}
		/**
		* Removes all key-value entries from the map.
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		async clear() {
			return await this._resource.update_items({ reset: true });
		}
		/**
		* Retrieves the value associated with a key.
		* @param {string} key - Key to look up
		* @returns {*} Associated value, or `undefined` if key does not exist
		*/
		get(key) {
			const item = this._resource.get_item(key);
			if (!item) return void 0;
			return item.state !== void 0 ? item.state : item.value;
		}
		/**
		* Checks whether a key exists in the map.
		* @param {string} key - Key to check
		* @returns {boolean} `true` if key exists, `false` otherwise
		*/
		has(key) {
			return this._resource.has_item(key);
		}
		/**
		* Returns an iterator over keys present in the map.
		* @returns {Iterator<string>} Iterator for map keys
		*/
		keys() {
			return this._resource.get_items().map((item) => item.id)[Symbol.iterator]();
		}
		/**
		* Returns an iterator over values present in the map.
		* @returns {Iterator<*>} Iterator for map values
		*/
		values() {
			return this._resource.get_items().map((item) => item.state !== void 0 ? item.state : item.value)[Symbol.iterator]();
		}
		/**
		* Returns an iterator over `[key, value]` pairs present in the map.
		* @returns {Iterator<Array>} Iterator for [key, value] pairs
		*/
		entries() {
			return this._resource.get_items().map((item) => [item.id, item.state !== void 0 ? item.state : item.value])[Symbol.iterator]();
		}
		/**
		* Executes a callback function once per map entry.
		* @param {Function} callback - Function executing `(value, key, map)`
		* @param {*} [thisArg] - Value to use as `this` when executing callback
		*/
		forEach(callback, thisArg) {
			for (const [key, val] of this.entries()) callback.call(thisArg, val, key, this);
		}
		/**
		* Returns an iterator over `[key, value]` entries.
		* @returns {Iterator<Array>} Iterator for map entries
		*/
		[Symbol.iterator]() {
			return this.entries();
		}
	};
	//#endregion
	//#region client/objects/set.js
	function canonicalStringify(val) {
		if (val === null || typeof val !== "object") return JSON.stringify(val);
		if (Array.isArray(val)) return "[" + val.map(canonicalStringify).join(",") + "]";
		return "{" + Object.keys(val).sort().map((k) => `${JSON.stringify(k)}:${canonicalStringify(val[k])}`).join(",") + "}";
	}
	/**
	* Callback function signature used to calculate a unique key for set elements.
	* @callback KeyFunction
	* @param {*} elem - Element added to or queried in the set
	* @returns {string|number} Unique key identifying the element
	*/
	/**
	* Online-hosted set data structure emulating the standard JavaScript `Set` interface.
	* Extends {@link BaseCollection}.
	* 
	* `SharedSet` implements the {@link Events} interface.
	* All state changes are emitted on the `"change"` event, with {@link Changes changes} as callback payload.
	* @class SharedSet
	*/
	var SharedSet = class extends BaseCollection {
		/**
		* Initializes a SharedSet instance.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Resource [Path](/design/representation/item_collection#path)
		* @param {Object} [options] - Configuration options
		* @param {KeyFunction} [options.key] - Custom element identity key function receiving `elem` and returning a unique key
		*/
		constructor(client, path, options = {}) {
			super(client, path, options, "SharedSet");
			this._keyFn = options.key || null;
		}
		_getId(elem) {
			if (this._keyFn) return String(this._keyFn(elem));
			if (elem !== null && typeof elem === "object" && elem.id !== void 0) return String(elem.id);
			return canonicalStringify(elem);
		}
		/**
		* Returns the number of elements in the set.
		* @type {number}
		* @readonly
		*/
		get size() {
			return this._resource.size;
		}
		/**
		* Adds an element to the set across the network.
		* @param {*} elem - Element to add
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		async add(elem) {
			const record = {
				id: this._getId(elem),
				state: elem
			};
			return await this._resource.update_items({ insert: [record] });
		}
		/**
		* Removes an element from the set.
		* @param {*} elem - Element to remove
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		async delete(elem) {
			const id = this._getId(elem);
			return await this._resource.update_items({ remove: [id] });
		}
		/**
		* Removes all elements from the set.
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		async clear() {
			return await this._resource.update_items({ reset: true });
		}
		/**
		* Checks whether an element exists in the set.
		* @param {*} elem - Element to check
		* @returns {boolean} `true` if element exists, `false` otherwise
		*/
		has(elem) {
			const id = this._getId(elem);
			return this._resource.has_item(id);
		}
		/**
		* Returns an iterator over elements in the set (alias for `values()`).
		* @returns {Iterator<*>} Iterator for set values
		*/
		keys() {
			return this.values();
		}
		/**
		* Returns an iterator over elements present in the set.
		* @returns {Iterator<*>} Iterator for set values
		*/
		values() {
			return this._resource.get_items().map((item) => item.state !== void 0 ? item.state : item.value)[Symbol.iterator]();
		}
		/**
		* Returns an iterator over `[value, value]` pairs present in the set.
		* @returns {Iterator<Array>} Iterator for value pairs
		*/
		entries() {
			return this._resource.get_items().map((item) => {
				const val = item.state !== void 0 ? item.state : item.value;
				return [val, val];
			})[Symbol.iterator]();
		}
		/**
		* Executes a callback function once per element in the set.
		* @param {Function} callback - Function executing `(value, value, set)`
		* @param {*} [thisArg] - Value to use as `this` when executing callback
		*/
		forEach(callback, thisArg) {
			for (const val of this.values()) callback.call(thisArg, val, val, this);
		}
		/**
		* Returns an iterator over set values.
		* @returns {Iterator<*>} Iterator for set values
		*/
		[Symbol.iterator]() {
			return this.values();
		}
	};
	//#endregion
	//#region client/base_objects/base_variable.js
	/**
	* SharedVariable represents an online-hosted value.
	* Extends {@link BaseAbstraction}.
	* 
	* `SharedVariable` implements the {@link Events} interface.
	* All state changes are emitted on the `"change"` event, with `{new: newValue, old: oldValue}` as callback payload.
	* @class BaseVariable
	*/
	var BaseVariable = class extends BaseAbstraction {
		/**
		* Initializes a new SharedVariable instance.
		* @param {SharedStateClient} client - The SharedState client instance
		* @param {string} path - Target path prefix (e.g. "/app/vars")
		* @param {string} name - Variable key name (e.g. "counter")
		* @param {Object} [options] - Configuration options
		* @param {string} [token] - Binding lock token (defaults to constructor name)
		*/
		constructor(client, path, name, options = {}, token = void 0) {
			if (!name || typeof name !== "string") throw new Error("Variable name must be a non-empty string");
			path = validatePath(path);
			const cached = BaseAbstraction.get_cached_instance(client, path, name);
			if (cached) return cached;
			const tok = token || new.target && new.target.name || "BaseVariable";
			super(client, tok, path, name, options);
			BaseAbstraction.cache_instance(client, path, name, this);
			this._itemId = name;
			this._resource.add_callback((diff) => {
				this._on_resource_update(diff);
			});
		}
		/**
		* The name/key of the variable.
		* @type {string}
		* @readonly
		*/
		get name() {
			return this._itemId;
		}
		/**
		* The current local value of the variable.
		* @type {*}
		* @readonly
		*/
		get value() {
			return this._resource.get();
		}
		/**
		* Gets the current value of the variable.
		* @returns {*} The current variable value
		*/
		get() {
			return this.value;
		}
		/**
		* Updates the variable value across the network.
		* @param {*} val - New value to set
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		set(val) {
			return this._resource.set(val);
		}
		_on_resource_update(diff) {
			this.emit("change", diff);
		}
		get_current_state(name) {
			if (name === "change") {
				const val = this.value;
				if (val === void 0) return null;
				return {
					new: val,
					old: void 0
				};
			}
			return null;
		}
	};
	//#endregion
	//#region client/base_objects/base_typed_variable.js
	/**
	* Enum for supported shared variable data types.
	*/
	var VariableType = {
		BOOL: "BOOL",
		STRING: "STRING",
		INTEGER: "INTEGER",
		FLOAT: "FLOAT",
		OBJECT: "OBJECT",
		ARRAY: "ARRAY"
	};
	/**
	* Type-specific default values and validation rules.
	*/
	var TYPE_CONFIG = {
		[VariableType.BOOL]: {
			default: false,
			validate(val) {
				if (typeof val === "boolean") return val;
				if (val === "true") return true;
				if (val === "false") return false;
			}
		},
		[VariableType.STRING]: {
			default: "",
			validate(val) {
				return typeof val === "string" ? val : void 0;
			}
		},
		[VariableType.INTEGER]: {
			default: 0,
			validate(val) {
				if (typeof val === "number" && Number.isInteger(val)) return val;
				if (typeof val === "string" && val.trim() !== "") {
					const parsed = parseInt(val, 10);
					if (!isNaN(parsed)) return parsed;
				}
			}
		},
		[VariableType.FLOAT]: {
			default: 0,
			validate(val) {
				if (typeof val === "number" && !isNaN(val)) return val;
				if (typeof val === "string" && val.trim() !== "") {
					const parsed = parseFloat(val);
					if (!isNaN(parsed)) return parsed;
				}
			}
		},
		[VariableType.OBJECT]: {
			default: {},
			validate(val) {
				if (typeof val === "object" && val !== null && !Array.isArray(val)) return val;
			}
		},
		[VariableType.ARRAY]: {
			default: [],
			validate(val) {
				return Array.isArray(val) ? val : void 0;
			}
		}
	};
	/**
	* Base class for typed shared variables.
	* Subclasses BaseVariable directly.
	*/
	var BaseTypedVariable = class extends BaseVariable {
		constructor(client, path, name, type, options = {}) {
			if (!type || !TYPE_CONFIG[type]) throw new Error(`Invalid type: ${type}. Supported types are ${Object.keys(TYPE_CONFIG).join(", ")}`);
			const tok = new.target && new.target.name || "BaseTypedVariable";
			super(client, path, name, options, tok);
			this._type = type;
			this._typeConfig = TYPE_CONFIG[type];
			this._isInitialised = false;
			let { allowUndefined = true, defaultValue = this._typeConfig.default, initialValue } = options;
			this._allowUndefined = Boolean(allowUndefined);
			this._defaultValue = this._typeConfig.validate(defaultValue);
			this._initialValue = this._typeConfig.validate(initialValue);
		}
		get type() {
			return this._type;
		}
		get defaultValue() {
			return this._defaultValue;
		}
		get initialValue() {
			return this._initialValue;
		}
		get allowUndefined() {
			return this._allowUndefined;
		}
		get value() {
			if (!this._resource) return void 0;
			const exists = this._resource.is_initialized();
			const raw = this._resource.get();
			let val = exists ? this._typeConfig.validate(raw) : void 0;
			const valid = val !== void 0 || this._allowUndefined;
			if (!valid) val = this._defaultValue;
			if (this._initialValue !== void 0 && !this._isInitialised) {
				if (!(exists && valid)) val = this._initialValue;
			}
			if (exists && valid && !this._isInitialised) this._isInitialised = true;
			return val;
		}
		set(val) {
			if (val === void 0) {
				if (!this._allowUndefined) throw new TypeError(`Cannot set value of '${this.name}' to undefined when allowUndefined is false.`);
				return super.set(void 0);
			}
			const value = this._typeConfig.validate(val);
			if (value === void 0) throw new TypeError("Illegal value for type: " + val);
			return super.set(value);
		}
	};
	//#endregion
	//#region client/objects/variables.js
	/**
	* Generic *untyped* variable holding any serializable value.
	* @class SharedVariable
	*/
	var SharedVariable = class extends BaseVariable {};
	/**
	* Variable restricted to *boolean* values.
	* @class SharedBoolean
	*/
	var SharedBoolean = class extends BaseTypedVariable {
		/**
		* Initializes a SharedBoolean.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Path prefix
		* @param {string} name - Variable key name
		* @param {Object} [options] - Configuration options
		*/
		constructor(client, path, name, options = {}) {
			super(client, path, name, VariableType.BOOL, options);
		}
		/**
		* Toggles the boolean value (`true` -> `false`, `false` -> `true`).
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		toggle() {
			const current = this.value;
			return this.set(!current);
		}
	};
	/**
	* Variable restricted to *string* values.
	* @class SharedString
	*/
	var SharedString = class extends BaseTypedVariable {
		/**
		* Initializes a SharedString.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Path prefix
		* @param {string} name - Variable key name
		* @param {Object} [options] - Configuration options
		*/
		constructor(client, path, name, options = {}) {
			super(client, path, name, VariableType.STRING, options);
		}
	};
	/**
	* Variable restricted to *integer* values.
	* Supports increment and decrement operations.
	* @class SharedInteger
	*/
	var SharedInteger = class extends BaseTypedVariable {
		/**
		* Initializes a SharedInteger.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Path prefix
		* @param {string} name - Variable key name
		* @param {Object} [options] - Configuration options
		*/
		constructor(client, path, name, options = {}) {
			super(client, path, name, VariableType.INTEGER, options);
		}
		/**
		* Increments the integer value by delta.
		* @param {number} [delta=1] - Amount to increment
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		inc(delta = 1) {
			const current = this.value;
			return this.set((current || 0) + delta);
		}
		/**
		* Decrements the integer value by delta.
		* @param {number} [delta=1] - Amount to decrement
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		dec(delta = 1) {
			const current = this.value;
			return this.set((current || 0) - delta);
		}
	};
	/**
	* Variable restricted to floating-point values.
	* Supports increment and decrement operations.
	* @class SharedFloat
	*/
	var SharedFloat = class extends BaseTypedVariable {
		/**
		* Initializes a SharedFloat.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Path prefix
		* @param {string} name - Variable key name
		* @param {Object} [options] - Configuration options
		*/
		constructor(client, path, name, options = {}) {
			super(client, path, name, VariableType.FLOAT, options);
		}
		/**
		* Increments the float value by delta.
		* @param {number} [delta=1.0] - Amount to increment
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		inc(delta = 1) {
			const current = this.value;
			return this.set((current || 0) + delta);
		}
		/**
		* Decrements the float value by delta.
		* @param {number} [delta=1.0] - Amount to decrement
		* @returns {Promise<void>} Resolves when update request is acknowledged by the server
		*/
		dec(delta = 1) {
			const current = this.value;
			return this.set((current || 0) - delta);
		}
	};
	/**
	* Variable restricted to *object* values.
	* @class SharedRecord
	*/
	var SharedRecord = class extends BaseTypedVariable {
		/**
		* Initializes a SharedRecord.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Path prefix
		* @param {string} name - Variable key name
		* @param {Object} [options] - Configuration options
		*/
		constructor(client, path, name, options = {}) {
			super(client, path, name, VariableType.OBJECT, options);
		}
	};
	/**
	* Variable restricted to *array* values.
	* @class SharedArray
	*/
	var SharedArray = class extends BaseTypedVariable {
		/**
		* Initializes a SharedArray.
		* @param {SharedStateClient} client - SharedState client instance
		* @param {string} path - Path prefix
		* @param {string} name - Variable key name
		* @param {Object} [options] - Configuration options
		*/
		constructor(client, path, name, options = {}) {
			super(client, path, name, VariableType.ARRAY, options);
		}
	};
	//#endregion
	//#region client/load.js
	/**
	* Registry mapping abstraction names to their implementation constructors.
	*/
	var TYPE_REGISTRY = {
		Map: SharedMap,
		Set: SharedSet,
		Boolean: SharedBoolean,
		Bool: SharedBoolean,
		String: SharedString,
		Integer: SharedInteger,
		Float: SharedFloat,
		Record: SharedRecord,
		Object: SharedRecord,
		Array: SharedArray,
		Variable: SharedVariable
	};
	/**
	* Standalone factory helper to configure and load Layer 2 abstraction objects.
	* @param {Object} client - SharedStateClient instance
	* @param {Object<string, {type: string, path: string, name?: string, options?: Object, optimistic?: boolean}>} config
	* @returns {Object<string, *>} Map of bound abstraction instances
	*/
	function load(client, config) {
		if (!client || typeof client.get_collection_resource !== "function") throw new Error("load() expects a SharedStateClient instance as first argument.");
		if (!config || typeof config !== "object") throw new Error("load() expects a configuration object as second argument.");
		const newObjects = {};
		const itemsToInstantiate = [];
		for (const [name, def] of Object.entries(config)) {
			if (!def || typeof def !== "object") throw new Error(`Invalid configuration for '${name}'. Expected object format: { type: "...", path: "..." }`);
			const typeName = def.type;
			const rawPath = def.path;
			const options = def.options || {};
			if (!typeName || !TYPE_REGISTRY[typeName]) throw new Error(`Unknown or missing type '${typeName}' for '${name}'. Supported types: ${Object.keys(TYPE_REGISTRY).join(", ")}`);
			const normPath = validatePath(rawPath);
			const ClassCtor = TYPE_REGISTRY[typeName];
			if ([
				SharedBoolean,
				SharedString,
				SharedInteger,
				SharedFloat,
				SharedRecord,
				SharedArray,
				SharedVariable
			].some((ctor) => ClassCtor === ctor || ClassCtor.prototype instanceof SharedVariable)) {
				const varName = def.name || name;
				itemsToInstantiate.push({
					name,
					ClassCtor,
					path: normPath,
					varName,
					isVariable: true,
					options
				});
			} else itemsToInstantiate.push({
				name,
				ClassCtor,
				path: normPath,
				isVariable: false,
				options
			});
		}
		for (const item of itemsToInstantiate) {
			let obj;
			if (item.isVariable) obj = new item.ClassCtor(client, item.path, item.varName, item.options);
			else obj = new item.ClassCtor(client, item.path, item.options);
			if (client._app_objects) client._app_objects[item.name] = obj;
			newObjects[item.name] = obj;
		}
		return newObjects;
	}
	//#endregion
	//#region client/definitions/collection_resource.js
	/**
	* Interface to resources that represent a collection of items.
	* @interface CollectionResource
	* @see {@link Item}
	* @see {@link Changes}
	*/
	var CollectionResource = class {
		/**
		* Underlying state provider instance.
		* @type {Object}
		* @readonly
		*/
		get provider() {}
		/**
		* Total number of items in the resource.
		* @type {number}
		* @readonly
		*/
		get size() {}
		/**
		* Retrieves an item by ID.
		* @param {string} id - Target item identifier
		* @returns {Item|undefined} 
		*/
		get_item(id) {}
		/**
		* Retrieves all items within the resource.
		* @returns {Item[]}
		*/
		get_items() {}
		/**
		* Checks if an item exists within the resource.
		* @param {string} id - Target item identifier
		* @returns {boolean} `true` if item exists, `false` otherwise
		*/
		has_item(id) {}
		/**
		* Request an update to items in the resource.
		* @param {Changes} changes - Requested {@link Changes}
		* @param {Object} [options] - Update options
		* @param {boolean} [options.dropIfModified=false] - If true, server drops the update request if resource has been modified by other client in the mean time.
		* @returns {Promise<Object>} Resolves when state update is acknowledged by the server
		*/
		update_items(changes, options = {}) {}
		/**
		* Registers a callback invoked whenever the resource changes.
		* @param {Function} handler(changes) - Callback function receiving change event
		* @returns {Object} Subscription handle object with `.remove_callback()`.
		*/
		add_callback(handler) {}
		/**
		* Removes a registered callback.
		* @param {Object} handle - Subscription handle returned from `add_callback`
		*/
		remove_callback(handle) {}
	};
	//#endregion
	//#region client/definitions/value_resource.js
	/**
	* Interface to resource that represents a single value.
	* @interface ValueResource
	*/
	var ValueResource = class {
		/**
		* Underlying state provider instance.
		* @type {Object}
		* @readonly
		*/
		get provider() {}
		/**
		* Retrieves the current value of the resource.
		* @returns {*} Current value or `undefined` if resource is not initialized
		*/
		get() {}
		/**
		* Checks whether the resource has been initialized.
		* @returns {boolean} `true` if resource is initialized, `false` otherwise
		*/
		is_initialized() {}
		/**
		* Request an update to the value of the resource.
		* @param {*} value - New value
		* @param {Object} [options] - Update options
		* @param {boolean} [options.dropIfModified=false] - If true, server drops the update request if resource has been modified by other client in the mean time.
		* @returns {Promise<Object>} Resolves when state update is dispatched/processed
		*/
		set(value, options = {}) {}
		/**
		* Registers a callback invoked whenever the resource value changes.
		* @param {Function} handler(diff) - Callback function receiving value diff `{ new: *, old: * }`
		* @returns {Object} Subscription handle with `.remove_callback()`
		*/
		add_callback(handler) {}
		/**
		* Removes a registered callback.
		* @param {Object} handle - Subscription handle returned from add_callback
		*/
		remove_callback(handle) {}
	};
	//#endregion
	exports.CollectionResource = CollectionResource;
	exports.Connection = Connection;
	exports.ConnectionState = ConnectionState;
	exports.ItemProvider = ItemProvider;
	exports.OptimisticItemProvider = OptimisticItemProvider;
	exports.SharedArray = SharedArray;
	exports.SharedBoolean = SharedBoolean;
	exports.SharedFloat = SharedFloat;
	exports.SharedInteger = SharedInteger;
	exports.SharedMap = SharedMap;
	exports.SharedRecord = SharedRecord;
	exports.SharedSet = SharedSet;
	exports.SharedStateClient = SharedStateClient;
	exports.SharedString = SharedString;
	exports.SharedVariable = SharedVariable;
	exports.SingleItemProvider = SingleItemProvider;
	exports.VERSION = VERSION;
	exports.ValueResource = ValueResource;
	exports.load = load;
});
