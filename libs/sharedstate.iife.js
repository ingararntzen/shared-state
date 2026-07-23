var SHAREDSTATE = (function (exports) {
    'use strict';

    /*
        Create a promise which can be resolved
        programmatically by external code.
        Return a promise and a resolve function
    */

    function resolvablePromise() {
        let resolver;
        let promise = new Promise((resolve, reject) => {
            resolver = resolve;
        });
        return [promise, resolver];
    }


    function random_string(length) {
        var text = "";
        var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        for(var i = 0; i < length; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }

    const MAX_RETRIES = 4;

    class WebSocketIO {

        constructor(url, options={}) {
            this._url = url;
            this._ws;
            this._connecting = false;
            this._connected = false;
            this._options = options;
            this._retries = 0;
            this._connect_promise_resolvers = [];
        }

        get connecting() {return this._connecting;}
        get connected() {return this._connected;}
        get url() {return this._url;}
        get options() {return this._options;}

        connect() {

            if (this.connecting || this.connected) {
                console.log("Connect while connecting or connected");
                return;
            }
            if (this._is_terminated()) {
                console.log("Terminated");
                return;
            }

            // connecting
            this._ws = new WebSocket(this._url);
            this._connecting = true;
            this._ws.onopen = e => this._on_open(e);
            this._ws.onmessage = e => this.on_message(e.data);
            this._ws.onclose = e => this._on_close(e);
            this._ws.onerror = e => this.on_error(e);
            this.on_connecting();
        }

        _on_open(event) {
            this._connecting = false;
            this._connected = true;
            // release connect promises
            for (const resolver of this._connect_promise_resolvers) {
                resolver();
            }
            this._connect_promise_resolvers = [];
            // reset retries on successful connection
            this._retries = 0;
            this.on_connect();
        }

        _on_close(event) {
            this._connecting = false;
            this._connected = false;
            this.on_disconnect(event);
            this._retries += 1;
            if (!this._is_terminated()) {
                setTimeout(() => {
                    this.connect();
                }, 1000 * this._retries);
            }    }

        _is_terminated() {
            const {retries=MAX_RETRIES} = this._options;
            if (this._retries >= retries) {
                console.log(`Terminated: Max retries reached (${retries})`);
                this._connecting = false;
                this._connected = true;
                this._ws.onopen = undefined;
                this._ws.onmessage = undefined;
                this._ws.onclose = undefined;
                this._ws.onerror = undefined;
                this._ws = undefined;
                return true;
            }
            return false;
        }

        on_connecting() {
            const {debug=false} = this._options;
            if (debug) {console.log(`Connecting ${this.url}`);}
        }
        on_connect() {
            console.log(`Connect  ${this.url}`);
        }
        on_error(error) {
            const {debug=false} = this._options;
            if (debug) {console.log(`Error: ${error}`);}
        }
        on_disconnect(event) {
            console.error(`Disconnect ${this.url}`);
        }
        on_message(data) {
            const {debug=false} = this._options;
            if (debug) {console.log(`Receive: ${data}`);}
        }

        send(data) {
            if (this._connected) {
                try {
                    this._ws.send(data);
                } catch (error) {
                    console.error(`Send fail: ${error}`);
                }
            } else {
                console.log(`Send drop : not connected`);
            }
        }

        connectedPromise() {
            const [promise, resolver] = resolvablePromise();
            if (this.connected) {
                resolver();
            } else {
                this._connect_promise_resolvers.push(resolver);
            }
            return promise;
        }
    }

    class ProxyCollection {

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
        _ssclient_update (changes={}) {

            if (this._terminated) {
                throw new Error("collection already terminated")
            }

            const {remove=[], insert=[], reset=false} = changes;
            const diff_map = new Map();

            // remove items - create diff
            if (reset) {
                for (const item of this._map.values()) {
                    diff_map.set(
                        item.id, 
                        {id: item.id, new:undefined, old:item}
                    );
                }
                this._map = new Map();
            } else {
                for (const _id of remove) {
                    const old = this._map.get(_id);
                    if (old != undefined) {
                        this._map.delete(_id);
                        diff_map.set(_id, {id:_id, new:undefined, old});
                    }
                }
            }

            // insert items - update diff
            for (const item of insert) {
                const _id = item.id;
                // old from diff_map or _map
                const diff = diff_map.get(_id);
                const old = (diff != undefined) ? diff.old : this._map.get(_id);
                // set state
                this._map.set(_id, item);
                // update diff map
                diff_map.set(_id, {id:_id, new:item, old});
            }
            this._notify_callbacks([...diff_map.values()]);
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

        /**
         * application dispatching update to server
         */
        update_items (changes={}) {
            if (this._terminated) {
                throw new Error("collection already terminated")
            }
            // ensure that inserted items have ids
            const {insert=[]} = changes;
            changes.insert = insert.map((item) => {
                item.id = item.id || random_string(10);
                return item;
            });
            return this._ssclient.update(this._path, changes);
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

    /**
     * Proxy Object
     * 
     * Client-side proxy object for a server-side object.
     *
     * Implementation leverages ProxyCollection. As such, the value of the proxy object
     * corresponds to the state property of a single item with *id* within a 
     * specific server-side collection. If no item with *id* exists in the collection, the
     * value of the proxy object is undefined. 
     * 
     * ProxyObject manages a set of items (an array) stored within a single item's state.
     * 
     * set_items() sets the entire array of items.
     * get_items() returns all items in the array.
     * get_item(id) returns a single item from the array.
     * has_item(id) returns true if an item with id exists in the array.
     * 
     */

    class ProxyObject {

        constructor(proxyCollection, id, options={}) {
            this._terminated = false;
            this._coll = proxyCollection;
            this._id = id;
            this._options = options;
            // callback
            this._handlers = [];
            this._handle = this._coll.add_callback(this._onchange.bind(this));
        }

        _onchange(diffs) {
            if (this._terminated) {
                throw new Error("proxy object terminated")
            }
            for (const diff of diffs) {
                if (diff.id == this._id) {
                    this.notify_callbacks(diff);
                }
            }
        }

        add_callback (handler) {
            const handle = {handler: handler};
            this._handlers.push(handle);
            return handle;
        };
        
        remove_callback (handle) {
            let index = this._handlers.indexOf(handle);
            if (index > -1) {
                this._handlers.splice(index, 1);
            }
        };
        
        notify_callbacks (eArg) {
            this._handlers.forEach(function(handle) {
                handle.handler(eArg);
            });
        };

        set_items (items) {
            if (this._terminated) {
                throw new Error("proxy object terminated")
            }
            if (!Array.isArray(items)) {
                throw new Error("items must be an array")
            }
            const insertItems = [{id:this._id, state:items}];
            return this._coll.update_items({insert:insertItems, reset:false});
        }

        get_items () {
            if (this._coll.has_item(this._id)) {
                const item = this._coll.get_item(this._id);
                return (item && item.state) ? item.state : [];
            } else {
                return [];
            }
        }

        get_item (id) {
            const items = this.get_items();
            return items.find(item => item.id === id);
        }

        has_item (id) {
            return this.get_item(id) !== undefined;
        }
        
        _ssclient_terminate() {
            this._terminated = true;
            this._coll.remove_callback(this._handle);
        }
    }

    // webpage clock - performance now - seconds
    const local = {
        now: function() {
            return performance.now()/1000.0;
        }
    };
    // system clock - epoch - seconds
    const epoch = {
        now: function() {
            return new Date()/1000.0;
        }
    };

    /**
     * CLOCK gives epoch values, but is implemented
     * using performance now for better
     * time resolution and protection against system 
     * time adjustments.
     */

    const CLOCK = function () {
        const t0_local = local.now();
        const t0_epoch = epoch.now();
        return {
            now: function () {
                const t1_local = local.now();
                return t0_epoch + (t1_local - t0_local);
            }
        };
    }();


    /**
     * Estimate the clock of the server 
     */

    const MAX_SAMPLE_COUNT = 30;

    class ServerClock {

        constructor(ssclient) {
            // sharestate client
            this._ssclient = ssclient;
            // pinger
            this._pinger = new Pinger(this._onping.bind(this));
            // samples
            this._samples = [];
            // estimates
            this._trans = 1000.0;
            this._skew = 0.0;
        }

        get pinger() {
            return this._pinger;
        }

        restart() {
            this._samples = [];
            this._trans = 1000.0;
            this._skew = 0.0;
            this._pinger.restart();
        }

        _onping() {
            const ts0 = CLOCK.now();
            this._ssclient.get("/clock").then(({ok, data}) => {
                if (ok) {
                    const ts1 = CLOCK.now();
                    this._add_sample(ts0, data, ts1);    
                }
            });
        }

        _add_sample(cs, ss, cr) {
            let trans = (cr - cs) / 2.0;
            let skew = ss - (cr + cs) / 2.0;
            let sample = [cs, ss, cr, trans, skew];
            // add to samples
            this._samples.push(sample);
            if (this._samples.length > MAX_SAMPLE_COUNT) {
                // remove first sample
                this._samples.shift();
            }
            // reevaluate estimates for skew and trans
            trans = 100000.0;
            skew = 0.0;
            for (const sample of this._samples) {
                if (sample[3] < trans) {
                    trans = sample[3];
                    skew = sample[4];
                }
            }
            this._skew = skew;
            this._trans = trans;
        }

        get skew() {return this._skew;}
        get trans() {return this._trans;}

        now() {
            // server clock is local clock + estimated skew
            return CLOCK.now() + this._skew;
        }

    }


    /*********************************************************
        PINGER
    **********************************************************/

    /**
     * Pinger invokes a callback repeatedly, indefinitely. 
     * Pinging in 3 stages, first frequently, then moderately, 
     * then slowly.
     */

    const SMALL_DELAY = 20; // ms
    const MEDIUM_DELAY = 500; // ms
    const LARGE_DELAY = 10000; // ms

    const DELAY_SEQUENCE = [
        ...new Array(3).fill(SMALL_DELAY), 
        ...new Array(7).fill(MEDIUM_DELAY),
        ...[LARGE_DELAY]
    ];

    class Pinger {

        constructor (callback) {
            this._count = 0;
            this._tid = undefined;
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
        ping () {
            let next_delay = this._delays[0];
            if (this._delays.length > 1) {
                this._delays.shift();
            }
            if (this._callback) {
                this._callback();
            }
            this._tid = setTimeout(this._ping, next_delay);
        }
    }

    const MsgType = Object.freeze({
        MESSAGE : "MESSAGE",
        REQUEST: "REQUEST",
        REPLY: "REPLY"
     });
     
    const MsgCmd = Object.freeze({
        GET : "GET",
        PUT: "PUT",
        NOTIFY: "NOTIFY"
    });


    class SharedStateClient extends WebSocketIO {

        constructor (url, options) {
            super(url, options);

            // requests
            this._reqid = 0;
            this._pending = new Map();

            // subscriptions
            // path -> {} 
            this._subs_map = new Map();

            // proxy collections {path -> proxy collection}
            this._coll_map = new Map();

            // proxy objects {[path, id] -> proxy object}
            this._obj_map = new Map();

            // server clock
            this._server_clock;

            this.connect();
        }

        /*********************************************************************
            CONNECTION 
        *********************************************************************/

        on_connect() {
            console.log(`Connect  ${this.url}`);
            // refresh local suscriptions
            if (this._subs_map.size > 0) {
                const items = [...this._subs_map.entries()];
                this.update("/subs", {insert:items, reset:true});
            }
            // server clock
            if (this._server_clock != undefined) {
                this._server_clock.restart();
            }
        }
        on_disconnect() {
            console.error(`Disconnect ${this.url}`);
            // server clock
            if (this._server_clock != undefined) {
                this._server_clock.pinger.pause();
            }
        }
        on_error(error) {
            const {debug=false} = this._options;
            if (debug) {console.log(`Communication Error: ${error}`);}
        }

        /*********************************************************************
            HANDLERS
        *********************************************************************/

        on_message(data) {
            let msg = JSON.parse(data);
            if (msg.type == MsgType.REPLY) {
                let reqid = msg.tunnel;
                if (this._pending.has(reqid)) {
                    let resolver = this._pending.get(reqid);
                    this._pending.delete(reqid);
                    const {ok, data} = msg;
                    resolver({ok, data});
                }
            } else if (msg.type == MsgType.MESSAGE) {
                if (msg.cmd == MsgCmd.NOTIFY) {
                    this._handle_notify(msg);
                }
            }
        }

        _handle_notify(msg) {
            // update proxy collection state
            const ds = this._coll_map.get(msg["path"]);
            if (ds != undefined) {
                ds._ssclient_update(msg["data"]);
            }
        }

        /*********************************************************************
            SERVER REQUESTS
        *********************************************************************/

        _request(cmd, path, arg) {
            const reqid = this._reqid++;
            const msg = {
                type: MsgType.REQUEST,
                cmd, 
                path, 
                arg,
                tunnel: reqid
            };
            this.send(JSON.stringify(msg));
            let [promise, resolver] = resolvablePromise();
            this._pending.set(reqid, resolver);
            return promise.then(({ok, data}) => {
                // special handling for replies to PUT /subs
                if (cmd == MsgCmd.PUT && path == "/subs" && ok) {
                    // update local subscription state
                    this._subs_map = new Map(data);
                }
                return {ok, path, data};
            });
        }

        _sub (path) {
            if (this.connected) {
                // copy current state of subs
                const subs_map = new Map([...this._subs_map]);
                // set new path
                subs_map.set(path, {});
                // reset subs on server
                const items = [...subs_map.entries()];
                return this.update("/subs", {insert:items, reset:true});
            } else {
                // update local subs - subscribe on reconnect
                this._subs_map.set(path, {});
                return Promise.resolve({ok: true, path, data:undefined})
            }

        }

        _unsub (path) {
            // copy current state of subs
            const subs_map = new Map([...this._subs_map]);
            // remove path
            subs_map.delete(path);
            // reset subs on server
            const items = [...subs_map.entries()];
            return this.update("/subs", {insert:items, reset:true});
        }

        /*********************************************************************
            API
        *********************************************************************/

        // accsessor for server clock
        get clock() {
            if (this._server_clock == undefined) {
                this._server_clock = new ServerClock(this);
                if (this.connected) {
                    this._server_clock.restart();
                }
            }
            return this._server_clock;
        }

        // get request for items by path
        get(path) {
            return this._request(MsgCmd.GET, path);
        }
        
        // update request for path
        update(path, changes) {
            return this._request(MsgCmd.PUT, path, changes);
        }

        /**
         * acquire proxy collection for path
         * - automatically subscribes to path if needed
         */
        acquire_collection (path, options) {
            path = path.startsWith("/") ? path : "/" + path;
            // subscribe if subscription does not exists
            if (!this._subs_map.has(path)) {
                // subscribe to path
                this._sub(path);
            }
            // create collection if not exists
            if (!this._coll_map.has(path)) {
                this._coll_map.set(path, new ProxyCollection(this, path, options));
            }
            return this._coll_map.get(path);
        }

        /**
         * acquire object for (path, name)
         * - automatically acquire proxy collection
         */
        acquire_object (path, name, options) {
            path = path.startsWith("/") ? path : "/" + path;
            const ds = this.acquire_collection(path);
            // create proxy object if not exists
            if (!this._obj_map.has(path)) {
                this._obj_map.set(path, new Map());
            }
            const obj_map = this._obj_map.get(path);
            if (!obj_map.get(name)) {
                obj_map.set(name, new ProxyObject(ds, name, options));
            }
            return obj_map.get(name)
        }

        /**
         * release path, including proxy collection and proxy objects
         */
        release(path) {
            // unsubscribe
            if (this._subs_map.has(path)) {
                this._unsub(path);
            }
            // terminate proxy collection and proxy objects
            const ds = this._coll_map.get(path);
            if (ds != undefined) {
                ds._ssclient_terminate();
            }
            const obj_map = this._obj_map.get(path);
            if (obj_map != undefined) {
                for (const v of obj_map.values()) {
                    v._ssclient_terminate();
                }    
            }
            this._coll_map.delete(path);
            this._obj_map.delete(path);
        }
    }

    exports.SharedStateClient = SharedStateClient;

    return exports;

})({});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vY2xpZW50L3V0aWwuanMiLCIuLi9jbGllbnQvd3Npby5qcyIsIi4uL2NsaWVudC9zc19jb2xsZWN0aW9uLmpzIiwiLi4vY2xpZW50L3NzX29iamVjdC5qcyIsIi4uL2NsaWVudC9zc19jbG9jay5qcyIsIi4uL2NsaWVudC9zc19jbGllbnQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAgICBDcmVhdGUgYSBwcm9taXNlIHdoaWNoIGNhbiBiZSByZXNvbHZlZFxuICAgIHByb2dyYW1tYXRpY2FsbHkgYnkgZXh0ZXJuYWwgY29kZS5cbiAgICBSZXR1cm4gYSBwcm9taXNlIGFuZCBhIHJlc29sdmUgZnVuY3Rpb25cbiovXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZhYmxlUHJvbWlzZSgpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHJlc29sdmVyID0gcmVzb2x2ZTtcbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXRQcm9taXNlIChtcykge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgbGV0IHRpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgfSwgbXMpO1xuICAgICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgICAgIGlmICh0aWQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmRvbV9zdHJpbmcobGVuZ3RoKSB7XG4gICAgdmFyIHRleHQgPSBcIlwiO1xuICAgIHZhciBwb3NzaWJsZSA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5elwiO1xuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICB0ZXh0ICs9IHBvc3NpYmxlLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb3NzaWJsZS5sZW5ndGgpKTtcbiAgICB9XG4gICAgcmV0dXJuIHRleHQ7XG59IiwiaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmNvbnN0IE1BWF9SRVRSSUVTID0gNDtcblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl91cmwgPSB1cmw7XG4gICAgICAgIHRoaXMuX3dzO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBnZXQgY29ubmVjdGluZygpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGluZzt9XG4gICAgZ2V0IGNvbm5lY3RlZCgpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGVkO31cbiAgICBnZXQgdXJsKCkge3JldHVybiB0aGlzLl91cmw7fVxuICAgIGdldCBvcHRpb25zKCkge3JldHVybiB0aGlzLl9vcHRpb25zO31cblxuICAgIGNvbm5lY3QoKSB7XG5cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGluZyB8fCB0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDb25uZWN0IHdoaWxlIGNvbm5lY3Rpbmcgb3IgY29ubmVjdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiVGVybWluYXRlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbm5lY3RpbmdcbiAgICAgICAgdGhpcy5fd3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuX3VybCk7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSBlID0+IHRoaXMuX29uX29wZW4oZSk7XG4gICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IGUgPT4gdGhpcy5vbl9tZXNzYWdlKGUuZGF0YSk7XG4gICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSBlID0+IHRoaXMuX29uX2Nsb3NlKGUpO1xuICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gZSA9PiB0aGlzLm9uX2Vycm9yKGUpO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3RpbmcoKTtcbiAgICB9XG5cbiAgICBfb25fb3BlbihldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgIC8vIHJlbGVhc2UgY29ubmVjdCBwcm9taXNlc1xuICAgICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgICAgICAvLyByZXNldCByZXRyaWVzIG9uIHN1Y2Nlc3NmdWwgY29ubmVjdGlvblxuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgX29uX2Nsb3NlKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMub25fZGlzY29ubmVjdChldmVudCk7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgKz0gMTtcbiAgICAgICAgaWYgKCF0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29ubmVjdCgpO1xuICAgICAgICAgICAgfSwgMTAwMCAqIHRoaXMuX3JldHJpZXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIF9pc190ZXJtaW5hdGVkKCkge1xuICAgICAgICBjb25zdCB7cmV0cmllcz1NQVhfUkVUUklFU30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAodGhpcy5fcmV0cmllcyA+PSByZXRyaWVzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVGVybWluYXRlZDogTWF4IHJldHJpZXMgcmVhY2hlZCAoJHtyZXRyaWVzfSlgKTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIG9uX2Nvbm5lY3RpbmcoKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29ubmVjdGluZyAke3RoaXMudXJsfWApO31cbiAgICB9XG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KGV2ZW50KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgUmVjZWl2ZTogJHtkYXRhfWApO31cbiAgICB9XG5cbiAgICBzZW5kKGRhdGEpIHtcbiAgICAgICAgaWYgKHRoaXMuX2Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLl93cy5zZW5kKGRhdGEpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTZW5kIGZhaWw6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VuZCBkcm9wIDogbm90IGNvbm5lY3RlZGApXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25uZWN0ZWRQcm9taXNlKCkge1xuICAgICAgICBjb25zdCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycy5wdXNoKHJlc29sdmVyKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgcmFuZG9tX3N0cmluZyB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuZXhwb3J0IGNsYXNzIFByb3h5Q29sbGVjdGlvbiB7XG5cbiAgICBjb25zdHJ1Y3Rvcihzc2NsaWVudCwgcGF0aCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZCA9IGZhbHNlO1xuICAgICAgICAvLyBzaGFyZWRzdGF0ZSBjbGllbnRcbiAgICAgICAgdGhpcy5fc3NjbGllbnQgPSBzc2NsaWVudDtcbiAgICAgICAgdGhpcy5fcGF0aCA9IHBhdGg7XG4gICAgICAgIC8vIGNhbGxiYWNrc1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgICAgICAvLyBpdGVtc1xuICAgICAgICB0aGlzLl9tYXAgPSBuZXcgTWFwKCk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBTSEFSRUQgU1RBVEUgQ0xJRU5UIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICAvKipcbiAgICAgKiBDb2xsZWN0aW9uIHJlbGVhc2VkIGJ5IHNzIGNsaWVudFxuICAgICAqL1xuXG4gICAgX3NzY2xpZW50X3Rlcm1pbmF0ZSgpIHtcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgIC8vIGVtcHR5IGNvbGxlY3Rpb24/XG4gICAgICAgIC8vIGRpc2Nvbm5lY3QgZnJvbSBvYnNlcnZlcnNcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBzZXJ2ZXIgdXBkYXRlIGNvbGxlY3Rpb24gXG4gICAgICovXG4gICAgX3NzY2xpZW50X3VwZGF0ZSAoY2hhbmdlcz17fSkge1xuXG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJjb2xsZWN0aW9uIGFscmVhZHkgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG5cbiAgICAgICAgY29uc3Qge3JlbW92ZT1bXSwgaW5zZXJ0PVtdLCByZXNldD1mYWxzZX0gPSBjaGFuZ2VzO1xuICAgICAgICBjb25zdCBkaWZmX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyByZW1vdmUgaXRlbXMgLSBjcmVhdGUgZGlmZlxuICAgICAgICBpZiAocmVzZXQpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB0aGlzLl9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgICAgICBkaWZmX21hcC5zZXQoXG4gICAgICAgICAgICAgICAgICAgIGl0ZW0uaWQsIFxuICAgICAgICAgICAgICAgICAgICB7aWQ6IGl0ZW0uaWQsIG5ldzp1bmRlZmluZWQsIG9sZDppdGVtfVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLl9tYXAgPSBuZXcgTWFwKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IF9pZCBvZiByZW1vdmUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBvbGQgPSB0aGlzLl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICAgICAgaWYgKG9sZCAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fbWFwLmRlbGV0ZShfaWQpO1xuICAgICAgICAgICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6dW5kZWZpbmVkLCBvbGR9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpbnNlcnQgaXRlbXMgLSB1cGRhdGUgZGlmZlxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaW5zZXJ0KSB7XG4gICAgICAgICAgICBjb25zdCBfaWQgPSBpdGVtLmlkO1xuICAgICAgICAgICAgLy8gb2xkIGZyb20gZGlmZl9tYXAgb3IgX21hcFxuICAgICAgICAgICAgY29uc3QgZGlmZiA9IGRpZmZfbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgY29uc3Qgb2xkID0gKGRpZmYgIT0gdW5kZWZpbmVkKSA/IGRpZmYub2xkIDogdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgLy8gc2V0IHN0YXRlXG4gICAgICAgICAgICB0aGlzLl9tYXAuc2V0KF9pZCwgaXRlbSk7XG4gICAgICAgICAgICAvLyB1cGRhdGUgZGlmZiBtYXBcbiAgICAgICAgICAgIGRpZmZfbWFwLnNldChfaWQsIHtpZDpfaWQsIG5ldzppdGVtLCBvbGR9KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9ub3RpZnlfY2FsbGJhY2tzKFsuLi5kaWZmX21hcC52YWx1ZXMoKV0pO1xuICAgIH1cblxuICAgIF9ub3RpZnlfY2FsbGJhY2tzIChlQXJnKSB7XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLmZvckVhY2goZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgICAgICBoYW5kbGUuaGFuZGxlcihlQXJnKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQVBQTElDQVRJT04gQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIGdldCBzaXplKCkge3JldHVybiB0aGlzLl9tYXAuc2l6ZX1cbiAgICBoYXNfaXRlbShpZCkge3JldHVybiB0aGlzLl9tYXAuaGFzKGlkKX1cbiAgICBnZXRfaXRlbShpZCkge3JldHVybiB0aGlzLl9tYXAuZ2V0KGlkKX1cbiAgICBnZXRfaXRlbXMoKSB7cmV0dXJuIFsuLi50aGlzLl9tYXAudmFsdWVzKCldfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gZGlzcGF0Y2hpbmcgdXBkYXRlIHRvIHNlcnZlclxuICAgICAqL1xuICAgIHVwZGF0ZV9pdGVtcyAoY2hhbmdlcz17fSkge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICAvLyBlbnN1cmUgdGhhdCBpbnNlcnRlZCBpdGVtcyBoYXZlIGlkc1xuICAgICAgICBjb25zdCB7aW5zZXJ0PVtdfSA9IGNoYW5nZXM7XG4gICAgICAgIGNoYW5nZXMuaW5zZXJ0ID0gaW5zZXJ0Lm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbS5pZCA9IGl0ZW0uaWQgfHwgcmFuZG9tX3N0cmluZygxMCk7XG4gICAgICAgICAgICByZXR1cm4gaXRlbTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9zc2NsaWVudC51cGRhdGUodGhpcy5fcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVnaXN0ZXIgY2FsbGJhY2tcbiAgICAqL1xuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9OyAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9OyAgICBcbn0iLCIvKipcbiAqIFByb3h5IE9iamVjdFxuICogXG4gKiBDbGllbnQtc2lkZSBwcm94eSBvYmplY3QgZm9yIGEgc2VydmVyLXNpZGUgb2JqZWN0LlxuICpcbiAqIEltcGxlbWVudGF0aW9uIGxldmVyYWdlcyBQcm94eUNvbGxlY3Rpb24uIEFzIHN1Y2gsIHRoZSB2YWx1ZSBvZiB0aGUgcHJveHkgb2JqZWN0XG4gKiBjb3JyZXNwb25kcyB0byB0aGUgc3RhdGUgcHJvcGVydHkgb2YgYSBzaW5nbGUgaXRlbSB3aXRoICppZCogd2l0aGluIGEgXG4gKiBzcGVjaWZpYyBzZXJ2ZXItc2lkZSBjb2xsZWN0aW9uLiBJZiBubyBpdGVtIHdpdGggKmlkKiBleGlzdHMgaW4gdGhlIGNvbGxlY3Rpb24sIHRoZVxuICogdmFsdWUgb2YgdGhlIHByb3h5IG9iamVjdCBpcyB1bmRlZmluZWQuIFxuICogXG4gKiBQcm94eU9iamVjdCBtYW5hZ2VzIGEgc2V0IG9mIGl0ZW1zIChhbiBhcnJheSkgc3RvcmVkIHdpdGhpbiBhIHNpbmdsZSBpdGVtJ3Mgc3RhdGUuXG4gKiBcbiAqIHNldF9pdGVtcygpIHNldHMgdGhlIGVudGlyZSBhcnJheSBvZiBpdGVtcy5cbiAqIGdldF9pdGVtcygpIHJldHVybnMgYWxsIGl0ZW1zIGluIHRoZSBhcnJheS5cbiAqIGdldF9pdGVtKGlkKSByZXR1cm5zIGEgc2luZ2xlIGl0ZW0gZnJvbSB0aGUgYXJyYXkuXG4gKiBoYXNfaXRlbShpZCkgcmV0dXJucyB0cnVlIGlmIGFuIGl0ZW0gd2l0aCBpZCBleGlzdHMgaW4gdGhlIGFycmF5LlxuICogXG4gKi9cblxuZXhwb3J0IGNsYXNzIFByb3h5T2JqZWN0IHtcblxuICAgIGNvbnN0cnVjdG9yKHByb3h5Q29sbGVjdGlvbiwgaWQsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb2xsID0gcHJveHlDb2xsZWN0aW9uO1xuICAgICAgICB0aGlzLl9pZCA9IGlkO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgLy8gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwcm94eSBvYmplY3QgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZGlmZiBvZiBkaWZmcykge1xuICAgICAgICAgICAgaWYgKGRpZmYuaWQgPT0gdGhpcy5faWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeV9jYWxsYmFja3MoZGlmZik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXI6IGhhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcbiAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTtcbiAgICBcbiAgICBub3RpZnlfY2FsbGJhY2tzIChlQXJnKSB7XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLmZvckVhY2goZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgICAgICBoYW5kbGUuaGFuZGxlcihlQXJnKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIHNldF9pdGVtcyAoaXRlbXMpIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInByb3h5IG9iamVjdCB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgaWYgKCFBcnJheS5pc0FycmF5KGl0ZW1zKSkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiaXRlbXMgbXVzdCBiZSBhbiBhcnJheVwiKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGluc2VydEl0ZW1zID0gW3tpZDp0aGlzLl9pZCwgc3RhdGU6aXRlbXN9XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGwudXBkYXRlX2l0ZW1zKHtpbnNlcnQ6aW5zZXJ0SXRlbXMsIHJlc2V0OmZhbHNlfSk7XG4gICAgfVxuXG4gICAgZ2V0X2l0ZW1zICgpIHtcbiAgICAgICAgaWYgKHRoaXMuX2NvbGwuaGFzX2l0ZW0odGhpcy5faWQpKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtID0gdGhpcy5fY29sbC5nZXRfaXRlbSh0aGlzLl9pZCk7XG4gICAgICAgICAgICByZXR1cm4gKGl0ZW0gJiYgaXRlbS5zdGF0ZSkgPyBpdGVtLnN0YXRlIDogW107XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gW107XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBnZXRfaXRlbSAoaWQpIHtcbiAgICAgICAgY29uc3QgaXRlbXMgPSB0aGlzLmdldF9pdGVtcygpO1xuICAgICAgICByZXR1cm4gaXRlbXMuZmluZChpdGVtID0+IGl0ZW0uaWQgPT09IGlkKTtcbiAgICB9XG5cbiAgICBoYXNfaXRlbSAoaWQpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuZ2V0X2l0ZW0oaWQpICE9PSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIFxuICAgIF9zc2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLl9jb2xsLnJlbW92ZV9jYWxsYmFjayh0aGlzLl9oYW5kbGUpO1xuICAgIH1cbn0iLCIvLyB3ZWJwYWdlIGNsb2NrIC0gcGVyZm9ybWFuY2Ugbm93IC0gc2Vjb25kc1xuY29uc3QgbG9jYWwgPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHBlcmZvcm1hbmNlLm5vdygpLzEwMDAuMDtcbiAgICB9XG59XG4vLyBzeXN0ZW0gY2xvY2sgLSBlcG9jaCAtIHNlY29uZHNcbmNvbnN0IGVwb2NoID0ge1xuICAgIG5vdzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuZXcgRGF0ZSgpLzEwMDAuMDtcbiAgICB9XG59XG5cbi8qKlxuICogQ0xPQ0sgZ2l2ZXMgZXBvY2ggdmFsdWVzLCBidXQgaXMgaW1wbGVtZW50ZWRcbiAqIHVzaW5nIHBlcmZvcm1hbmNlIG5vdyBmb3IgYmV0dGVyXG4gKiB0aW1lIHJlc29sdXRpb24gYW5kIHByb3RlY3Rpb24gYWdhaW5zdCBzeXN0ZW0gXG4gKiB0aW1lIGFkanVzdG1lbnRzLlxuICovXG5cbmNvbnN0IENMT0NLID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbnN0IHQwX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgY29uc3QgdDBfZXBvY2ggPSBlcG9jaC5ub3coKTtcbiAgICByZXR1cm4ge1xuICAgICAgICBub3c6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGNvbnN0IHQxX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgICAgICAgICByZXR1cm4gdDBfZXBvY2ggKyAodDFfbG9jYWwgLSB0MF9sb2NhbCk7XG4gICAgICAgIH1cbiAgICB9O1xufSgpO1xuXG5cbi8qKlxuICogRXN0aW1hdGUgdGhlIGNsb2NrIG9mIHRoZSBzZXJ2ZXIgXG4gKi9cblxuY29uc3QgTUFYX1NBTVBMRV9DT1VOVCA9IDMwO1xuXG5leHBvcnQgY2xhc3MgU2VydmVyQ2xvY2sge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQpIHtcbiAgICAgICAgLy8gc2hhcmVzdGF0ZSBjbGllbnRcbiAgICAgICAgdGhpcy5fc3NjbGllbnQgPSBzc2NsaWVudDtcbiAgICAgICAgLy8gcGluZ2VyXG4gICAgICAgIHRoaXMuX3BpbmdlciA9IG5ldyBQaW5nZXIodGhpcy5fb25waW5nLmJpbmQodGhpcykpO1xuICAgICAgICAvLyBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMgPSBbXTtcbiAgICAgICAgLy8gZXN0aW1hdGVzXG4gICAgICAgIHRoaXMuX3RyYW5zID0gMTAwMC4wO1xuICAgICAgICB0aGlzLl9za2V3ID0gMC4wO1xuICAgIH1cblxuICAgIGdldCBwaW5nZXIoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9waW5nZXI7XG4gICAgfVxuXG4gICAgcmVzdGFydCgpIHtcbiAgICAgICAgdGhpcy5fc2FtcGxlcyA9IFtdO1xuICAgICAgICB0aGlzLl90cmFucyA9IDEwMDAuMDtcbiAgICAgICAgdGhpcy5fc2tldyA9IDAuMDtcbiAgICAgICAgdGhpcy5fcGluZ2VyLnJlc3RhcnQoKTtcbiAgICB9XG5cbiAgICBfb25waW5nKCkge1xuICAgICAgICBjb25zdCB0czAgPSBDTE9DSy5ub3coKTtcbiAgICAgICAgdGhpcy5fc3NjbGllbnQuZ2V0KFwiL2Nsb2NrXCIpLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIGlmIChvaykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRzMSA9IENMT0NLLm5vdygpO1xuICAgICAgICAgICAgICAgIHRoaXMuX2FkZF9zYW1wbGUodHMwLCBkYXRhLCB0czEpOyAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX2FkZF9zYW1wbGUoY3MsIHNzLCBjcikge1xuICAgICAgICBsZXQgdHJhbnMgPSAoY3IgLSBjcykgLyAyLjA7XG4gICAgICAgIGxldCBza2V3ID0gc3MgLSAoY3IgKyBjcykgLyAyLjA7XG4gICAgICAgIGxldCBzYW1wbGUgPSBbY3MsIHNzLCBjciwgdHJhbnMsIHNrZXddO1xuICAgICAgICAvLyBhZGQgdG8gc2FtcGxlc1xuICAgICAgICB0aGlzLl9zYW1wbGVzLnB1c2goc2FtcGxlKVxuICAgICAgICBpZiAodGhpcy5fc2FtcGxlcy5sZW5ndGggPiBNQVhfU0FNUExFX0NPVU5UKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgZmlyc3Qgc2FtcGxlXG4gICAgICAgICAgICB0aGlzLl9zYW1wbGVzLnNoaWZ0KCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gcmVldmFsdWF0ZSBlc3RpbWF0ZXMgZm9yIHNrZXcgYW5kIHRyYW5zXG4gICAgICAgIHRyYW5zID0gMTAwMDAwLjA7XG4gICAgICAgIHNrZXcgPSAwLjA7XG4gICAgICAgIGZvciAoY29uc3Qgc2FtcGxlIG9mIHRoaXMuX3NhbXBsZXMpIHtcbiAgICAgICAgICAgIGlmIChzYW1wbGVbM10gPCB0cmFucykge1xuICAgICAgICAgICAgICAgIHRyYW5zID0gc2FtcGxlWzNdO1xuICAgICAgICAgICAgICAgIHNrZXcgPSBzYW1wbGVbNF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fc2tldyA9IHNrZXc7XG4gICAgICAgIHRoaXMuX3RyYW5zID0gdHJhbnM7XG4gICAgfVxuXG4gICAgZ2V0IHNrZXcoKSB7cmV0dXJuIHRoaXMuX3NrZXc7fVxuICAgIGdldCB0cmFucygpIHtyZXR1cm4gdGhpcy5fdHJhbnM7fVxuXG4gICAgbm93KCkge1xuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2sgaXMgbG9jYWwgY2xvY2sgKyBlc3RpbWF0ZWQgc2tld1xuICAgICAgICByZXR1cm4gQ0xPQ0subm93KCkgKyB0aGlzLl9za2V3O1xuICAgIH1cblxufVxuXG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICBQSU5HRVJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbi8qKlxuICogUGluZ2VyIGludm9rZXMgYSBjYWxsYmFjayByZXBlYXRlZGx5LCBpbmRlZmluaXRlbHkuIFxuICogUGluZ2luZyBpbiAzIHN0YWdlcywgZmlyc3QgZnJlcXVlbnRseSwgdGhlbiBtb2RlcmF0ZWx5LCBcbiAqIHRoZW4gc2xvd2x5LlxuICovXG5cbmNvbnN0IFNNQUxMX0RFTEFZID0gMjA7IC8vIG1zXG5jb25zdCBNRURJVU1fREVMQVkgPSA1MDA7IC8vIG1zXG5jb25zdCBMQVJHRV9ERUxBWSA9IDEwMDAwOyAvLyBtc1xuXG5jb25zdCBERUxBWV9TRVFVRU5DRSA9IFtcbiAgICAuLi5uZXcgQXJyYXkoMykuZmlsbChTTUFMTF9ERUxBWSksIFxuICAgIC4uLm5ldyBBcnJheSg3KS5maWxsKE1FRElVTV9ERUxBWSksXG4gICAgLi4uW0xBUkdFX0RFTEFZXVxuXTtcblxuY2xhc3MgUGluZ2VyIHtcblxuICAgIGNvbnN0cnVjdG9yIChjYWxsYmFjaykge1xuICAgICAgICB0aGlzLl9jb3VudCA9IDA7XG4gICAgICAgIHRoaXMuX3RpZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5fY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgICAgICAgdGhpcy5fcGluZyA9IHRoaXMucGluZy5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9kZWxheXMgPSBbLi4uREVMQVlfU0VRVUVOQ0VdO1xuICAgIH1cbiAgICBwYXVzZSgpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgfVxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgICAgIHRoaXMucGluZygpO1xuICAgIH1cbiAgICByZXN0YXJ0KCkge1xuICAgICAgICB0aGlzLl9kZWxheXMgPSBbLi4uREVMQVlfU0VRVUVOQ0VdO1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHBpbmcgKCkge1xuICAgICAgICBsZXQgbmV4dF9kZWxheSA9IHRoaXMuX2RlbGF5c1swXTtcbiAgICAgICAgaWYgKHRoaXMuX2RlbGF5cy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLl9kZWxheXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5fY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHRoaXMuX2NhbGxiYWNrKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGlkID0gc2V0VGltZW91dCh0aGlzLl9waW5nLCBuZXh0X2RlbGF5KTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgV2ViU29ja2V0SU8gfSBmcm9tIFwiLi93c2lvLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IFByb3h5Q29sbGVjdGlvbiB9IGZyb20gXCIuL3NzX2NvbGxlY3Rpb24uanNcIjtcbmltcG9ydCB7IFByb3h5T2JqZWN0IH0gZnJvbSBcIi4vc3Nfb2JqZWN0LmpzXCI7XG5pbXBvcnQgeyBTZXJ2ZXJDbG9jayB9IGZyb20gXCIuL3NzX2Nsb2NrLmpzXCI7XG5cbmNvbnN0IE1zZ1R5cGUgPSBPYmplY3QuZnJlZXplKHtcbiAgICBNRVNTQUdFIDogXCJNRVNTQUdFXCIsXG4gICAgUkVRVUVTVDogXCJSRVFVRVNUXCIsXG4gICAgUkVQTFk6IFwiUkVQTFlcIlxuIH0pO1xuIFxuY29uc3QgTXNnQ21kID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgR0VUIDogXCJHRVRcIixcbiAgICBQVVQ6IFwiUFVUXCIsXG4gICAgTk9USUZZOiBcIk5PVElGWVwiXG59KTtcblxuXG5leHBvcnQgY2xhc3MgU2hhcmVkU3RhdGVDbGllbnQgZXh0ZW5kcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3RvciAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKHVybCwgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gcmVxdWVzdHNcbiAgICAgICAgdGhpcy5fcmVxaWQgPSAwO1xuICAgICAgICB0aGlzLl9wZW5kaW5nID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgLy8gcGF0aCAtPiB7fSBcbiAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcHJveHkgY29sbGVjdGlvbnMge3BhdGggLT4gcHJveHkgY29sbGVjdGlvbn1cbiAgICAgICAgdGhpcy5fY29sbF9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcHJveHkgb2JqZWN0cyB7W3BhdGgsIGlkXSAtPiBwcm94eSBvYmplY3R9XG4gICAgICAgIHRoaXMuX29ial9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jaztcblxuICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIENPTk5FQ1RJT04gXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHJlZnJlc2ggbG9jYWwgc3VzY3JpcHRpb25zXG4gICAgICAgIGlmICh0aGlzLl9zdWJzX21hcC5zaXplID4gMCkge1xuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3RhcnQoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnBpbmdlci5wYXVzZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29tbXVuaWNhdGlvbiBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBIQU5ETEVSU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBsZXQgbXNnID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuUkVQTFkpIHtcbiAgICAgICAgICAgIGxldCByZXFpZCA9IG1zZy50dW5uZWw7XG4gICAgICAgICAgICBpZiAodGhpcy5fcGVuZGluZy5oYXMocmVxaWQpKSB7XG4gICAgICAgICAgICAgICAgbGV0IHJlc29sdmVyID0gdGhpcy5fcGVuZGluZy5nZXQocmVxaWQpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3BlbmRpbmcuZGVsZXRlKHJlcWlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCB7b2ssIGRhdGF9ID0gbXNnO1xuICAgICAgICAgICAgICAgIHJlc29sdmVyKHtvaywgZGF0YX0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuTUVTU0FHRSkge1xuICAgICAgICAgICAgaWYgKG1zZy5jbWQgPT0gTXNnQ21kLk5PVElGWSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2hhbmRsZV9ub3RpZnkobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9oYW5kbGVfbm90aWZ5KG1zZykge1xuICAgICAgICAvLyB1cGRhdGUgcHJveHkgY29sbGVjdGlvbiBzdGF0ZVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChtc2dbXCJwYXRoXCJdKTtcbiAgICAgICAgaWYgKGRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZHMuX3NzY2xpZW50X3VwZGF0ZShtc2dbXCJkYXRhXCJdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0VSVkVSIFJFUVVFU1RTXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgX3JlcXVlc3QoY21kLCBwYXRoLCBhcmcpIHtcbiAgICAgICAgY29uc3QgcmVxaWQgPSB0aGlzLl9yZXFpZCsrO1xuICAgICAgICBjb25zdCBtc2cgPSB7XG4gICAgICAgICAgICB0eXBlOiBNc2dUeXBlLlJFUVVFU1QsXG4gICAgICAgICAgICBjbWQsIFxuICAgICAgICAgICAgcGF0aCwgXG4gICAgICAgICAgICBhcmcsXG4gICAgICAgICAgICB0dW5uZWw6IHJlcWlkXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuc2VuZChKU09OLnN0cmluZ2lmeShtc2cpKTtcbiAgICAgICAgbGV0IFtwcm9taXNlLCByZXNvbHZlcl0gPSByZXNvbHZhYmxlUHJvbWlzZSgpO1xuICAgICAgICB0aGlzLl9wZW5kaW5nLnNldChyZXFpZCwgcmVzb2x2ZXIpO1xuICAgICAgICByZXR1cm4gcHJvbWlzZS50aGVuKCh7b2ssIGRhdGF9KSA9PiB7XG4gICAgICAgICAgICAvLyBzcGVjaWFsIGhhbmRsaW5nIGZvciByZXBsaWVzIHRvIFBVVCAvc3Vic1xuICAgICAgICAgICAgaWYgKGNtZCA9PSBNc2dDbWQuUFVUICYmIHBhdGggPT0gXCIvc3Vic1wiICYmIG9rKSB7XG4gICAgICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnNjcmlwdGlvbiBzdGF0ZVxuICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcChkYXRhKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtvaywgcGF0aCwgZGF0YX07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9zdWIgKHBhdGgpIHtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAgICAgLy8gc2V0IG5ldyBwYXRoXG4gICAgICAgICAgICBzdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnN1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3VicyAtIHN1YnNjcmliZSBvbiByZWNvbm5lY3RcbiAgICAgICAgICAgIHRoaXMuX3N1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtvazogdHJ1ZSwgcGF0aCwgZGF0YTp1bmRlZmluZWR9KVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBfdW5zdWIgKHBhdGgpIHtcbiAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAvLyByZW1vdmUgcGF0aFxuICAgICAgICBzdWJzX21hcC5kZWxldGUocGF0aClcbiAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4uc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLy8gYWNjc2Vzc29yIGZvciBzZXJ2ZXIgY2xvY2tcbiAgICBnZXQgY2xvY2soKSB7XG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sgPSBuZXcgU2VydmVyQ2xvY2sodGhpcyk7XG4gICAgICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucmVzdGFydCgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9zZXJ2ZXJfY2xvY2s7XG4gICAgfVxuXG4gICAgLy8gZ2V0IHJlcXVlc3QgZm9yIGl0ZW1zIGJ5IHBhdGhcbiAgICBnZXQocGF0aCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuR0VULCBwYXRoKTtcbiAgICB9XG4gICAgXG4gICAgLy8gdXBkYXRlIHJlcXVlc3QgZm9yIHBhdGhcbiAgICB1cGRhdGUocGF0aCwgY2hhbmdlcykge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuUFVULCBwYXRoLCBjaGFuZ2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIHByb3h5IGNvbGxlY3Rpb24gZm9yIHBhdGhcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlcyB0byBwYXRoIGlmIG5lZWRlZFxuICAgICAqL1xuICAgIGFjcXVpcmVfY29sbGVjdGlvbiAocGF0aCwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBzdWJzY3JpcHRpb24gZG9lcyBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBjb2xsZWN0aW9uIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9jb2xsX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2NvbGxfbWFwLnNldChwYXRoLCBuZXcgUHJveHlDb2xsZWN0aW9uKHRoaXMsIHBhdGgsIG9wdGlvbnMpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY29sbF9tYXAuZ2V0KHBhdGgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFjcXVpcmUgb2JqZWN0IGZvciAocGF0aCwgbmFtZSlcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgYWNxdWlyZSBwcm94eSBjb2xsZWN0aW9uXG4gICAgICovXG4gICAgYWNxdWlyZV9vYmplY3QgKHBhdGgsIG5hbWUsIG9wdGlvbnMpIHtcbiAgICAgICAgcGF0aCA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoIDogXCIvXCIgKyBwYXRoO1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuYWNxdWlyZV9jb2xsZWN0aW9uKHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgcHJveHkgb2JqZWN0IGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9vYmpfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fb2JqX21hcC5zZXQocGF0aCwgbmV3IE1hcCgpKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvYmpfbWFwID0gdGhpcy5fb2JqX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmICghb2JqX21hcC5nZXQobmFtZSkpIHtcbiAgICAgICAgICAgIG9ial9tYXAuc2V0KG5hbWUsIG5ldyBQcm94eU9iamVjdChkcywgbmFtZSwgb3B0aW9ucykpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9ial9tYXAuZ2V0KG5hbWUpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogcmVsZWFzZSBwYXRoLCBpbmNsdWRpbmcgcHJveHkgY29sbGVjdGlvbiBhbmQgcHJveHkgb2JqZWN0c1xuICAgICAqL1xuICAgIHJlbGVhc2UocGF0aCkge1xuICAgICAgICAvLyB1bnN1YnNjcmliZVxuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl91bnN1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyB0ZXJtaW5hdGUgcHJveHkgY29sbGVjdGlvbiBhbmQgcHJveHkgb2JqZWN0c1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKGRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZHMuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9ial9tYXAgPSB0aGlzLl9vYmpfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKG9ial9tYXAgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHYgb2Ygb2JqX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIHYuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICAgICAgfSAgICBcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb2xsX21hcC5kZWxldGUocGF0aCk7XG4gICAgICAgIHRoaXMuX29ial9tYXAuZGVsZXRlKHBhdGgpO1xuICAgIH1cbn1cblxuXG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0lBQUE7SUFDQTtJQUNBO0lBQ0E7SUFDQTs7SUFFTyxTQUFTLGlCQUFpQixHQUFHO0lBQ3BDLElBQUksSUFBSSxRQUFRO0lB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
