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

    class Collection {

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

            const {remove, insert, reset=false} = changes;
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
        has(id) {return this._map.has(id)}
        get(id) {
            if (id == undefined) {
                return [...this._map.values()]
            } else {
                return this._map.get(id)
            }
        }

        /**
         * application dispatching update to server
         */
        update (changes={}) {
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
     * Variable
     * 
     * Wrapper to expose a single id (item) from a collection as a standalone variable
     * 
     * - if there is no item with id in collection - the variable will be undefined
     *   or have a default value
     * - otherwise, the variable will be the value of item.data
     * 
     *  Default value is given in options {value:}
     */

    class Variable {

        constructor(coll, id, options={}) {
            this._terminiated = false;
            this._coll = coll;
            this._id = id;
            this._options = options;
            // callback
            this._handlers = [];
            this._handle = this._coll.add_callback(this._onchange.bind(this));
        }

        _onchange(diffs) {
            if (this._terminated) {
                throw new Error("variable terminated")
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
                this._handers.splice(index, 1);
            }
        };
        
        notify_callbacks (eArg) {
            this._handlers.forEach(function(handle) {
                handle.handler(eArg);
            });
        };

        
        set (value) {
            if (this._terminated) {
                throw new Error("varible terminated")
            }
            const items = [{id:this._id, data:value}];
            return this._coll.update({insert:items, reset:false});
        }

        get () {
            if (this._coll.has(this._id)) {
                return this._coll.get(this._id).data;
            } else {
                return this._options.value;
            }
        }
        
        ss_client_terminate() {
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

        resume() {
            this._pinger.resume();
        }

        pause() {
            this._pinger.pause();
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

            // collections {path -> collection}
            this._coll_map = new Map();

            // variables {[path, id] -> variable}
            this._var_map = new Map();

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
                this._server_clock.resume();
            }
        }
        on_disconnect() {
            console.error(`Disconnect ${this.url}`);
            // server clock
            if (this._server_clock != undefined) {
                this._server_clock.pause();
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
            // update collection state
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
                const items = [...this._subs_map.entries()];
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
                    this._server_clock.resume();
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
         * acquire collection for path
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
                this._coll_map.set(path, new Collection(this, path, options));
            }
            return this._coll_map.get(path);
        }

        /**
         * acquire variable for (path, name)
         * - automatically acquire collection
         */
        acquire_variable (path, name, options) {
            path = path.startsWith("/") ? path : "/" + path;
            const ds = this.acquire_collection(path);
            // create variable if not exists
            if (!this._var_map.has(path)) {
                this._var_map.set(path, new Map());
            }
            const var_map = this._var_map.get(path);
            if (!var_map.get(name)) {
                var_map.set(name, new Variable(ds, name, options));
            }
            return var_map.get(name)
        }

        /**
         * release path, including collection and variables
         */
        release(path) {
            // unsubscribe
            if (this._subs_map.has(path)) {
                this._unsub(path);
            }
            // terminate collection and variables
            const ds = this._coll_map.get(path);
            ds._ssclient_terminate();
            const var_map = this._var_map.get(path);
            if (var_map != undefined) {
                for (const v of var_map.values()) {
                    v._ssclient_terminate();
                }    
            }
            this._coll_map.delete(path);
            this._var_map.delete(path);
        }
    }

    /*
        Collection Viewer
    */

    function item2string(item) {
        const {id, itv, data} = item;
        let data_txt = JSON.stringify(data);
        let itv_txt = (itv != undefined) ? JSON.stringify(itv) : "";
        let id_html = `<span class="id">${id}</span>`;
        let itv_html = `<span class="itv">${itv_txt}</span>`;
        let data_html = `<span class="data">${data_txt}</span>`;
        return `
        <div>
            <button id="delete">X</button>
            ${id_html}: ${itv_html} ${data_html}
        </div>`;
    }


    class CollectionViewer {

        constructor(collection, elem, options={}) {
            this._coll = collection;
            this._elem = elem;
            this._handle = this._coll.add_callback(this._onchange.bind(this)); 

            // options
            let defaults = {
                delete:false,
                toString:item2string
            };
            this._options = {...defaults, ...options};

            /*
                Support delete
            */
            if (this._options.delete) {
                // listen for click events on root element
                elem.addEventListener("click", (e) => {
                    // catch click event from delete button
                    const deleteBtn = e.target.closest("#delete");
                    if (deleteBtn) {
                        const listItem = deleteBtn.closest(".list-item");
                        if (listItem) {
                            this._coll.update({remove:[listItem.id]});
                            e.stopPropagation();
                        }
                    }
                });
            }

            /*
                render initial state
            */ 
            const diffs = this._coll.get()
                .map(item => {
                    return {id:item.id, new:item}
                });
            this._onchange(diffs);
        }

        _onchange(diffs) {
            const {toString} = this._options;
            for (let diff of diffs) {
                if (diff.new) {
                    // add
                    let node = this._elem.querySelector(`#${diff.id}`);
                    if (node == null) {
                        node = document.createElement("div");
                        node.setAttribute("id", diff.id);
                        node.classList.add("list-item");
                        this._elem.appendChild(node);
                    }
                    node.innerHTML = toString(diff.new);
                } else if (diff.old) {
                    // remove
                    let node = this._elem.querySelector(`#${diff.id}`);
                    if (node) {
                        node.parentNode.removeChild(node);
                    }
                }
            }
        }
    }

    exports.CollectionViewer = CollectionViewer;
    exports.SharedStateClient = SharedStateClient;

    return exports;

})({});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vY2xpZW50L3V0aWwuanMiLCIuLi8uLi9jbGllbnQvd3Npby5qcyIsIi4uLy4uL2NsaWVudC9jb2xsZWN0aW9uLmpzIiwiLi4vLi4vY2xpZW50L3ZhcmlhYmxlLmpzIiwiLi4vLi4vY2xpZW50L3NlcnZlcmNsb2NrLmpzIiwiLi4vLi4vY2xpZW50L3NzX2NsaWVudC5qcyIsIi4uLy4uL2NsaWVudC92aWV3ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAgICBDcmVhdGUgYSBwcm9taXNlIHdoaWNoIGNhbiBiZSByZXNvbHZlZFxuICAgIHByb2dyYW1tYXRpY2FsbHkgYnkgZXh0ZXJuYWwgY29kZS5cbiAgICBSZXR1cm4gYSBwcm9taXNlIGFuZCBhIHJlc29sdmUgZnVuY3Rpb25cbiovXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZhYmxlUHJvbWlzZSgpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHJlc29sdmVyID0gcmVzb2x2ZTtcbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXRQcm9taXNlIChtcykge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgbGV0IHRpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgfSwgbXMpO1xuICAgICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgICAgIGlmICh0aWQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmRvbV9zdHJpbmcobGVuZ3RoKSB7XG4gICAgdmFyIHRleHQgPSBcIlwiO1xuICAgIHZhciBwb3NzaWJsZSA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5elwiO1xuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICB0ZXh0ICs9IHBvc3NpYmxlLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb3NzaWJsZS5sZW5ndGgpKTtcbiAgICB9XG4gICAgcmV0dXJuIHRleHQ7XG59IiwiaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmNvbnN0IE1BWF9SRVRSSUVTID0gNDtcblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl91cmwgPSB1cmw7XG4gICAgICAgIHRoaXMuX3dzO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBnZXQgY29ubmVjdGluZygpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGluZzt9XG4gICAgZ2V0IGNvbm5lY3RlZCgpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGVkO31cbiAgICBnZXQgdXJsKCkge3JldHVybiB0aGlzLl91cmw7fVxuICAgIGdldCBvcHRpb25zKCkge3JldHVybiB0aGlzLl9vcHRpb25zO31cblxuICAgIGNvbm5lY3QoKSB7XG5cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGluZyB8fCB0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDb25uZWN0IHdoaWxlIGNvbm5lY3Rpbmcgb3IgY29ubmVjdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiVGVybWluYXRlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbm5lY3RpbmdcbiAgICAgICAgdGhpcy5fd3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuX3VybCk7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSBlID0+IHRoaXMuX29uX29wZW4oZSk7XG4gICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IGUgPT4gdGhpcy5vbl9tZXNzYWdlKGUuZGF0YSk7XG4gICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSBlID0+IHRoaXMuX29uX2Nsb3NlKGUpO1xuICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gZSA9PiB0aGlzLm9uX2Vycm9yKGUpO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3RpbmcoKTtcbiAgICB9XG5cbiAgICBfb25fb3BlbihldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgIC8vIHJlbGVhc2UgY29ubmVjdCBwcm9taXNlc1xuICAgICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgICAgICAvLyByZXNldCByZXRyaWVzIG9uIHN1Y2Nlc3NmdWwgY29ubmVjdGlvblxuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgX29uX2Nsb3NlKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMub25fZGlzY29ubmVjdChldmVudCk7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgKz0gMTtcbiAgICAgICAgaWYgKCF0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29ubmVjdCgpO1xuICAgICAgICAgICAgfSwgMTAwMCAqIHRoaXMuX3JldHJpZXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIF9pc190ZXJtaW5hdGVkKCkge1xuICAgICAgICBjb25zdCB7cmV0cmllcz1NQVhfUkVUUklFU30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAodGhpcy5fcmV0cmllcyA+PSByZXRyaWVzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVGVybWluYXRlZDogTWF4IHJldHJpZXMgcmVhY2hlZCAoJHtyZXRyaWVzfSlgKTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIG9uX2Nvbm5lY3RpbmcoKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29ubmVjdGluZyAke3RoaXMudXJsfWApO31cbiAgICB9XG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KGV2ZW50KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgUmVjZWl2ZTogJHtkYXRhfWApO31cbiAgICB9XG5cbiAgICBzZW5kKGRhdGEpIHtcbiAgICAgICAgaWYgKHRoaXMuX2Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLl93cy5zZW5kKGRhdGEpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTZW5kIGZhaWw6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VuZCBkcm9wIDogbm90IGNvbm5lY3RlZGApXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25uZWN0ZWRQcm9taXNlKCkge1xuICAgICAgICBjb25zdCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycy5wdXNoKHJlc29sdmVyKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgcmFuZG9tX3N0cmluZyB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuZXhwb3J0IGNsYXNzIENvbGxlY3Rpb24ge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxlYXNlZCBieSBzcyBjbGllbnRcbiAgICAgKi9cblxuICAgIF9zc2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAvLyBlbXB0eSBjb2xsZWN0aW9uP1xuICAgICAgICAvLyBkaXNjb25uZWN0IGZyb20gb2JzZXJ2ZXJzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBjb2xsZWN0aW9uIFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHtyZW1vdmUsIGluc2VydCwgcmVzZXQ9ZmFsc2V9ID0gY2hhbmdlcztcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlIGl0ZW1zIC0gY3JlYXRlIGRpZmZcbiAgICAgICAgaWYgKHJlc2V0KSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdGhpcy5fbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KFxuICAgICAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICAgICAge2lkOiBpdGVtLmlkLCBuZXc6dW5kZWZpbmVkLCBvbGQ6aXRlbX1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBfaWQgb2YgcmVtb3ZlKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb2xkID0gdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcC5kZWxldGUoX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3OnVuZGVmaW5lZCwgb2xkfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0IGl0ZW1zIC0gdXBkYXRlIGRpZmZcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGluc2VydCkge1xuICAgICAgICAgICAgY29uc3QgX2lkID0gaXRlbS5pZDtcbiAgICAgICAgICAgIC8vIG9sZCBmcm9tIGRpZmZfbWFwIG9yIF9tYXBcbiAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBkaWZmX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IChkaWZmICE9IHVuZGVmaW5lZCkgPyBkaWZmLm9sZCA6IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIC8vIHNldCBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5fbWFwLnNldChfaWQsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gdXBkYXRlIGRpZmYgbWFwXG4gICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6aXRlbSwgb2xkfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5X2NhbGxiYWNrcyhbLi4uZGlmZl9tYXAudmFsdWVzKCldKTtcbiAgICB9XG5cbiAgICBfbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQUExJQ0FUSU9OIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9XG4gICAgaGFzKGlkKSB7cmV0dXJuIHRoaXMuX21hcC5oYXMoaWQpfVxuICAgIGdldChpZCkge1xuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gWy4uLnRoaXMuX21hcC52YWx1ZXMoKV1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAuZ2V0KGlkKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gZGlzcGF0Y2hpbmcgdXBkYXRlIHRvIHNlcnZlclxuICAgICAqL1xuICAgIHVwZGF0ZSAoY2hhbmdlcz17fSkge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICAvLyBlbnN1cmUgdGhhdCBpbnNlcnRlZCBpdGVtcyBoYXZlIGlkc1xuICAgICAgICBjb25zdCB7aW5zZXJ0PVtdfSA9IGNoYW5nZXM7XG4gICAgICAgIGNoYW5nZXMuaW5zZXJ0ID0gaW5zZXJ0Lm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbS5pZCA9IGl0ZW0uaWQgfHwgcmFuZG9tX3N0cmluZygxMCk7XG4gICAgICAgICAgICByZXR1cm4gaXRlbTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9zc2NsaWVudC51cGRhdGUodGhpcy5fcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVnaXN0ZXIgY2FsbGJhY2tcbiAgICAqL1xuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9OyAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9OyAgICBcbn0iLCJcbi8qKlxuICogVmFyaWFibGVcbiAqIFxuICogV3JhcHBlciB0byBleHBvc2UgYSBzaW5nbGUgaWQgKGl0ZW0pIGZyb20gYSBjb2xsZWN0aW9uIGFzIGEgc3RhbmRhbG9uZSB2YXJpYWJsZVxuICogXG4gKiAtIGlmIHRoZXJlIGlzIG5vIGl0ZW0gd2l0aCBpZCBpbiBjb2xsZWN0aW9uIC0gdGhlIHZhcmlhYmxlIHdpbGwgYmUgdW5kZWZpbmVkXG4gKiAgIG9yIGhhdmUgYSBkZWZhdWx0IHZhbHVlXG4gKiAtIG90aGVyd2lzZSwgdGhlIHZhcmlhYmxlIHdpbGwgYmUgdGhlIHZhbHVlIG9mIGl0ZW0uZGF0YVxuICogXG4gKiAgRGVmYXVsdCB2YWx1ZSBpcyBnaXZlbiBpbiBvcHRpb25zIHt2YWx1ZTp9XG4gKi9cblxuZXhwb3J0IGNsYXNzIFZhcmlhYmxlIHtcblxuICAgIGNvbnN0cnVjdG9yKGNvbGwsIGlkLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmlhdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2NvbGwgPSBjb2xsO1xuICAgICAgICB0aGlzLl9pZCA9IGlkO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgLy8gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYWJsZSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5pZCA9PSB0aGlzLl9pZCkge1xuICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5X2NhbGxiYWNrcyhkaWZmKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcjogaGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9O1xuICAgIFxuICAgIHJlbW92ZV9jYWxsYmFjayAoaGFuZGxlKSB7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgXG4gICAgbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBcbiAgICBzZXQgKHZhbHVlKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYmxlIHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpdGVtcyA9IFt7aWQ6dGhpcy5faWQsIGRhdGE6dmFsdWV9XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGwudXBkYXRlKHtpbnNlcnQ6aXRlbXMsIHJlc2V0OmZhbHNlfSk7XG4gICAgfVxuXG4gICAgZ2V0ICgpIHtcbiAgICAgICAgaWYgKHRoaXMuX2NvbGwuaGFzKHRoaXMuX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGwuZ2V0KHRoaXMuX2lkKS5kYXRhO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX29wdGlvbnMudmFsdWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgc3NfY2xpZW50X3Rlcm1pbmF0ZSgpIHtcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuX2NvbGwucmVtb3ZlX2NhbGxiYWNrKHRoaXMuX2hhbmRsZSk7XG4gICAgfVxufSIsIi8vIHdlYnBhZ2UgY2xvY2sgLSBwZXJmb3JtYW5jZSBub3cgLSBzZWNvbmRzXG5jb25zdCBsb2NhbCA9IHtcbiAgICBub3c6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcGVyZm9ybWFuY2Uubm93KCkvMTAwMC4wO1xuICAgIH1cbn1cbi8vIHN5c3RlbSBjbG9jayAtIGVwb2NoIC0gc2Vjb25kc1xuY29uc3QgZXBvY2ggPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBEYXRlKCkvMTAwMC4wO1xuICAgIH1cbn1cblxuLyoqXG4gKiBDTE9DSyBnaXZlcyBlcG9jaCB2YWx1ZXMsIGJ1dCBpcyBpbXBsZW1lbnRlZFxuICogdXNpbmcgcGVyZm9ybWFuY2Ugbm93IGZvciBiZXR0ZXJcbiAqIHRpbWUgcmVzb2x1dGlvbiBhbmQgcHJvdGVjdGlvbiBhZ2FpbnN0IHN5c3RlbSBcbiAqIHRpbWUgYWRqdXN0bWVudHMuXG4gKi9cblxuY29uc3QgQ0xPQ0sgPSBmdW5jdGlvbiAoKSB7XG4gICAgY29uc3QgdDBfbG9jYWwgPSBsb2NhbC5ub3coKTtcbiAgICBjb25zdCB0MF9lcG9jaCA9IGVwb2NoLm5vdygpO1xuICAgIHJldHVybiB7XG4gICAgICAgIG5vdzogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY29uc3QgdDFfbG9jYWwgPSBsb2NhbC5ub3coKTtcbiAgICAgICAgICAgIHJldHVybiB0MF9lcG9jaCArICh0MV9sb2NhbCAtIHQwX2xvY2FsKTtcbiAgICAgICAgfVxuICAgIH07XG59KCk7XG5cblxuLyoqXG4gKiBFc3RpbWF0ZSB0aGUgY2xvY2sgb2YgdGhlIHNlcnZlciBcbiAqL1xuXG5jb25zdCBNQVhfU0FNUExFX0NPVU5UID0gMzA7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXJDbG9jayB7XG5cbiAgICBjb25zdHJ1Y3Rvcihzc2NsaWVudCkge1xuICAgICAgICAvLyBzaGFyZXN0YXRlIGNsaWVudFxuICAgICAgICB0aGlzLl9zc2NsaWVudCA9IHNzY2xpZW50O1xuICAgICAgICAvLyBwaW5nZXJcbiAgICAgICAgdGhpcy5fcGluZ2VyID0gbmV3IFBpbmdlcih0aGlzLl9vbnBpbmcuYmluZCh0aGlzKSk7XG4gICAgICAgIC8vIHNhbXBsZXNcbiAgICAgICAgdGhpcy5fc2FtcGxlcyA9IFtdO1xuICAgICAgICAvLyBlc3RpbWF0ZXNcbiAgICAgICAgdGhpcy5fdHJhbnMgPSAxMDAwLjA7XG4gICAgICAgIHRoaXMuX3NrZXcgPSAwLjA7XG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICB0aGlzLl9waW5nZXIucmVzdW1lKCk7XG4gICAgfVxuXG4gICAgcGF1c2UoKSB7XG4gICAgICAgIHRoaXMuX3Bpbmdlci5wYXVzZSgpO1xuICAgIH1cblxuICAgIF9vbnBpbmcoKSB7XG4gICAgICAgIGNvbnN0IHRzMCA9IENMT0NLLm5vdygpO1xuICAgICAgICB0aGlzLl9zc2NsaWVudC5nZXQoXCIvY2xvY2tcIikudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgaWYgKG9rKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHMxID0gQ0xPQ0subm93KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fYWRkX3NhbXBsZSh0czAsIGRhdGEsIHRzMSk7ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfYWRkX3NhbXBsZShjcywgc3MsIGNyKSB7XG4gICAgICAgIGxldCB0cmFucyA9IChjciAtIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNrZXcgPSBzcyAtIChjciArIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNhbXBsZSA9IFtjcywgc3MsIGNyLCB0cmFucywgc2tld107XG4gICAgICAgIC8vIGFkZCB0byBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMucHVzaChzYW1wbGUpXG4gICAgICAgIGlmICh0aGlzLl9zYW1wbGVzLmxlbmd0aCA+IE1BWF9TQU1QTEVfQ09VTlQpIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZSBmaXJzdCBzYW1wbGVcbiAgICAgICAgICAgIHRoaXMuX3NhbXBsZXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZWV2YWx1YXRlIGVzdGltYXRlcyBmb3Igc2tldyBhbmQgdHJhbnNcbiAgICAgICAgdHJhbnMgPSAxMDAwMDAuMDtcbiAgICAgICAgc2tldyA9IDAuMDtcbiAgICAgICAgZm9yIChjb25zdCBzYW1wbGUgb2YgdGhpcy5fc2FtcGxlcykge1xuICAgICAgICAgICAgaWYgKHNhbXBsZVszXSA8IHRyYW5zKSB7XG4gICAgICAgICAgICAgICAgdHJhbnMgPSBzYW1wbGVbM107XG4gICAgICAgICAgICAgICAgc2tldyA9IHNhbXBsZVs0XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9za2V3ID0gc2tldztcbiAgICAgICAgdGhpcy5fdHJhbnMgPSB0cmFucztcbiAgICB9XG5cbiAgICBnZXQgc2tldygpIHtyZXR1cm4gdGhpcy5fc2tldzt9XG4gICAgZ2V0IHRyYW5zKCkge3JldHVybiB0aGlzLl90cmFuczt9XG5cbiAgICBub3coKSB7XG4gICAgICAgIC8vIHNlcnZlciBjbG9jayBpcyBsb2NhbCBjbG9jayArIGVzdGltYXRlZCBza2V3XG4gICAgICAgIHJldHVybiBDTE9DSy5ub3coKSArIHRoaXMuX3NrZXc7XG4gICAgfVxuXG59XG5cblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgIFBJTkdFUlxuKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuLyoqXG4gKiBQaW5nZXIgaW52b2tlcyBhIGNhbGxiYWNrIHJlcGVhdGVkbHksIGluZGVmaW5pdGVseS4gXG4gKiBQaW5naW5nIGluIDMgc3RhZ2VzLCBmaXJzdCBmcmVxdWVudGx5LCB0aGVuIG1vZGVyYXRlbHksIFxuICogdGhlbiBzbG93bHkuXG4gKi9cblxuY29uc3QgU01BTExfREVMQVkgPSAyMDsgLy8gbXNcbmNvbnN0IE1FRElVTV9ERUxBWSA9IDUwMDsgLy8gbXNcbmNvbnN0IExBUkdFX0RFTEFZID0gMTAwMDA7IC8vIG1zXG5cbmNvbnN0IERFTEFZX1NFUVVFTkNFID0gW1xuICAgIC4uLm5ldyBBcnJheSgzKS5maWxsKFNNQUxMX0RFTEFZKSwgXG4gICAgLi4ubmV3IEFycmF5KDcpLmZpbGwoTUVESVVNX0RFTEFZKSxcbiAgICAuLi5bTEFSR0VfREVMQVldXG5dO1xuXG5jbGFzcyBQaW5nZXIge1xuXG4gICAgY29uc3RydWN0b3IgKGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuX2NvdW50ID0gMDtcbiAgICAgICAgdGhpcy5fdGlkID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICAgICAgICB0aGlzLl9waW5nID0gdGhpcy5waW5nLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuX2RlbGF5cyA9IFsuLi5ERUxBWV9TRVFVRU5DRV07XG4gICAgfVxuICAgIHBhdXNlKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICB9XG4gICAgcmVzdW1lKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHJlc3RhcnQoKSB7XG4gICAgICAgIHRoaXMuX2RlbGF5cyA9IFsuLi5ERUxBWV9TRVFVRU5DRV07XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgICAgICB0aGlzLnBpbmcoKTtcbiAgICB9XG4gICAgcGluZyAoKSB7XG4gICAgICAgIGxldCBuZXh0X2RlbGF5ID0gdGhpcy5fZGVsYXlzWzBdO1xuICAgICAgICBpZiAodGhpcy5fZGVsYXlzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMuX2RlbGF5cy5zaGlmdCgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9jYWxsYmFjaykge1xuICAgICAgICAgICAgdGhpcy5fY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl90aWQgPSBzZXRUaW1lb3V0KHRoaXMuX3BpbmcsIG5leHRfZGVsYXkpO1xuICAgIH1cbn1cblxuXG4iLCJpbXBvcnQgeyBXZWJTb2NrZXRJTyB9IGZyb20gXCIuL3dzaW8uanNcIjtcbmltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuaW1wb3J0IHsgQ29sbGVjdGlvbiB9IGZyb20gXCIuL2NvbGxlY3Rpb24uanNcIjtcbmltcG9ydCB7IFZhcmlhYmxlIH0gZnJvbSBcIi4vdmFyaWFibGUuanNcIjtcbmltcG9ydCB7IFNlcnZlckNsb2NrIH0gZnJvbSBcIi4vc2VydmVyY2xvY2suanNcIjtcblxuY29uc3QgTXNnVHlwZSA9IE9iamVjdC5mcmVlemUoe1xuICAgIE1FU1NBR0UgOiBcIk1FU1NBR0VcIixcbiAgICBSRVFVRVNUOiBcIlJFUVVFU1RcIixcbiAgICBSRVBMWTogXCJSRVBMWVwiXG4gfSk7XG4gXG5jb25zdCBNc2dDbWQgPSBPYmplY3QuZnJlZXplKHtcbiAgICBHRVQgOiBcIkdFVFwiLFxuICAgIFBVVDogXCJQVVRcIixcbiAgICBOT1RJRlk6IFwiTk9USUZZXCJcbn0pO1xuXG5cbmV4cG9ydCBjbGFzcyBTaGFyZWRTdGF0ZUNsaWVudCBleHRlbmRzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yICh1cmwsIG9wdGlvbnMpIHtcbiAgICAgICAgc3VwZXIodXJsLCBvcHRpb25zKTtcblxuICAgICAgICAvLyByZXF1ZXN0c1xuICAgICAgICB0aGlzLl9yZXFpZCA9IDA7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc3Vic2NyaXB0aW9uc1xuICAgICAgICAvLyBwYXRoIC0+IHt9IFxuICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBjb2xsZWN0aW9ucyB7cGF0aCAtPiBjb2xsZWN0aW9ufVxuICAgICAgICB0aGlzLl9jb2xsX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyB2YXJpYWJsZXMge1twYXRoLCBpZF0gLT4gdmFyaWFibGV9XG4gICAgICAgIHRoaXMuX3Zhcl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jaztcblxuICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIENPTk5FQ1RJT04gXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHJlZnJlc2ggbG9jYWwgc3VzY3JpcHRpb25zXG4gICAgICAgIGlmICh0aGlzLl9zdWJzX21hcC5zaXplID4gMCkge1xuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3VtZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9uX2Rpc2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucGF1c2UoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbW11bmljYXRpb24gRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgSEFORExFUlNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgbGV0IG1zZyA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLlJFUExZKSB7XG4gICAgICAgICAgICBsZXQgcmVxaWQgPSBtc2cudHVubmVsO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmcuaGFzKHJlcWlkKSkge1xuICAgICAgICAgICAgICAgIGxldCByZXNvbHZlciA9IHRoaXMuX3BlbmRpbmcuZ2V0KHJlcWlkKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nLmRlbGV0ZShyZXFpZCk7XG4gICAgICAgICAgICAgICAgY29uc3Qge29rLCBkYXRhfSA9IG1zZztcbiAgICAgICAgICAgICAgICByZXNvbHZlcih7b2ssIGRhdGF9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLk1FU1NBR0UpIHtcbiAgICAgICAgICAgIGlmIChtc2cuY21kID09IE1zZ0NtZC5OT1RJRlkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVfbm90aWZ5KG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX25vdGlmeShtc2cpIHtcbiAgICAgICAgLy8gdXBkYXRlIGNvbGxlY3Rpb24gc3RhdGVcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9jb2xsX21hcC5nZXQobXNnW1wicGF0aFwiXSk7XG4gICAgICAgIGlmIChkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRzLl9zc2NsaWVudF91cGRhdGUobXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNFUlZFUiBSRVFVRVNUU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIF9yZXF1ZXN0KGNtZCwgcGF0aCwgYXJnKSB7XG4gICAgICAgIGNvbnN0IHJlcWlkID0gdGhpcy5fcmVxaWQrKztcbiAgICAgICAgY29uc3QgbXNnID0ge1xuICAgICAgICAgICAgdHlwZTogTXNnVHlwZS5SRVFVRVNULFxuICAgICAgICAgICAgY21kLCBcbiAgICAgICAgICAgIHBhdGgsIFxuICAgICAgICAgICAgYXJnLFxuICAgICAgICAgICAgdHVubmVsOiByZXFpZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlbmQoSlNPTi5zdHJpbmdpZnkobXNnKSk7XG4gICAgICAgIGxldCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgdGhpcy5fcGVuZGluZy5zZXQocmVxaWQsIHJlc29sdmVyKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgLy8gc3BlY2lhbCBoYW5kbGluZyBmb3IgcmVwbGllcyB0byBQVVQgL3N1YnNcbiAgICAgICAgICAgIGlmIChjbWQgPT0gTXNnQ21kLlBVVCAmJiBwYXRoID09IFwiL3N1YnNcIiAmJiBvaykge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzY3JpcHRpb24gc3RhdGVcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoZGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7b2ssIHBhdGgsIGRhdGF9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfc3ViIChwYXRoKSB7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgICAgIC8vIHNldCBuZXcgcGF0aFxuICAgICAgICAgICAgc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnMgLSBzdWJzY3JpYmUgb24gcmVjb25uZWN0XG4gICAgICAgICAgICB0aGlzLl9zdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7b2s6IHRydWUsIHBhdGgsIGRhdGE6dW5kZWZpbmVkfSlcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgX3Vuc3ViIChwYXRoKSB7XG4gICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgLy8gcmVtb3ZlIHBhdGhcbiAgICAgICAgc3Vic19tYXAuZGVsZXRlKHBhdGgpXG4gICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnN1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8vIGFjY3Nlc3NvciBmb3Igc2VydmVyIGNsb2NrXG4gICAgZ2V0IGNsb2NrKCkge1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrID0gbmV3IFNlcnZlckNsb2NrKHRoaXMpO1xuICAgICAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3VtZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9zZXJ2ZXJfY2xvY2s7XG4gICAgfVxuXG4gICAgLy8gZ2V0IHJlcXVlc3QgZm9yIGl0ZW1zIGJ5IHBhdGhcbiAgICBnZXQocGF0aCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuR0VULCBwYXRoKTtcbiAgICB9XG4gICAgXG4gICAgLy8gdXBkYXRlIHJlcXVlc3QgZm9yIHBhdGhcbiAgICB1cGRhdGUocGF0aCwgY2hhbmdlcykge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuUFVULCBwYXRoLCBjaGFuZ2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIGNvbGxlY3Rpb24gZm9yIHBhdGhcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlcyB0byBwYXRoIGlmIG5lZWRlZFxuICAgICAqL1xuICAgIGFjcXVpcmVfY29sbGVjdGlvbiAocGF0aCwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBzdWJzY3JpcHRpb24gZG9lcyBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBjb2xsZWN0aW9uIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9jb2xsX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2NvbGxfbWFwLnNldChwYXRoLCBuZXcgQ29sbGVjdGlvbih0aGlzLCBwYXRoLCBvcHRpb25zKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIHZhcmlhYmxlIGZvciAocGF0aCwgbmFtZSlcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgYWNxdWlyZSBjb2xsZWN0aW9uXG4gICAgICovXG4gICAgYWNxdWlyZV92YXJpYWJsZSAocGF0aCwgbmFtZSwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5hY3F1aXJlX2NvbGxlY3Rpb24ocGF0aCk7XG4gICAgICAgIC8vIGNyZWF0ZSB2YXJpYWJsZSBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fdmFyX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX3Zhcl9tYXAuc2V0KHBhdGgsIG5ldyBNYXAoKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmFyX21hcCA9IHRoaXMuX3Zhcl9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAoIXZhcl9tYXAuZ2V0KG5hbWUpKSB7XG4gICAgICAgICAgICB2YXJfbWFwLnNldChuYW1lLCBuZXcgVmFyaWFibGUoZHMsIG5hbWUsIG9wdGlvbnMpKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB2YXJfbWFwLmdldChuYW1lKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHJlbGVhc2UgcGF0aCwgaW5jbHVkaW5nIGNvbGxlY3Rpb24gYW5kIHZhcmlhYmxlc1xuICAgICAqL1xuICAgIHJlbGVhc2UocGF0aCkge1xuICAgICAgICAvLyB1bnN1YnNjcmliZVxuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl91bnN1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyB0ZXJtaW5hdGUgY29sbGVjdGlvbiBhbmQgdmFyaWFibGVzXG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fY29sbF9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBkcy5fc3NjbGllbnRfdGVybWluYXRlKCk7XG4gICAgICAgIGNvbnN0IHZhcl9tYXAgPSB0aGlzLl92YXJfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKHZhcl9tYXAgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHYgb2YgdmFyX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIHYuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICAgICAgfSAgICBcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb2xsX21hcC5kZWxldGUocGF0aCk7XG4gICAgICAgIHRoaXMuX3Zhcl9tYXAuZGVsZXRlKHBhdGgpO1xuICAgIH1cbn1cblxuXG4iLCIvKlxuICAgIENvbGxlY3Rpb24gVmlld2VyXG4qL1xuXG5mdW5jdGlvbiBpdGVtMnN0cmluZyhpdGVtKSB7XG4gICAgY29uc3Qge2lkLCBpdHYsIGRhdGF9ID0gaXRlbTtcbiAgICBsZXQgZGF0YV90eHQgPSBKU09OLnN0cmluZ2lmeShkYXRhKTtcbiAgICBsZXQgaXR2X3R4dCA9IChpdHYgIT0gdW5kZWZpbmVkKSA/IEpTT04uc3RyaW5naWZ5KGl0dikgOiBcIlwiO1xuICAgIGxldCBpZF9odG1sID0gYDxzcGFuIGNsYXNzPVwiaWRcIj4ke2lkfTwvc3Bhbj5gO1xuICAgIGxldCBpdHZfaHRtbCA9IGA8c3BhbiBjbGFzcz1cIml0dlwiPiR7aXR2X3R4dH08L3NwYW4+YDtcbiAgICBsZXQgZGF0YV9odG1sID0gYDxzcGFuIGNsYXNzPVwiZGF0YVwiPiR7ZGF0YV90eHR9PC9zcGFuPmA7XG4gICAgcmV0dXJuIGBcbiAgICAgICAgPGRpdj5cbiAgICAgICAgICAgIDxidXR0b24gaWQ9XCJkZWxldGVcIj5YPC9idXR0b24+XG4gICAgICAgICAgICAke2lkX2h0bWx9OiAke2l0dl9odG1sfSAke2RhdGFfaHRtbH1cbiAgICAgICAgPC9kaXY+YDtcbn1cblxuXG5leHBvcnQgY2xhc3MgQ29sbGVjdGlvblZpZXdlciB7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb2xsZWN0aW9uLCBlbGVtLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX2NvbGwgPSBjb2xsZWN0aW9uO1xuICAgICAgICB0aGlzLl9lbGVtID0gZWxlbTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7IFxuXG4gICAgICAgIC8vIG9wdGlvbnNcbiAgICAgICAgbGV0IGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgZGVsZXRlOmZhbHNlLFxuICAgICAgICAgICAgdG9TdHJpbmc6aXRlbTJzdHJpbmdcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHsuLi5kZWZhdWx0cywgLi4ub3B0aW9uc307XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIFN1cHBvcnQgZGVsZXRlXG4gICAgICAgICovXG4gICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmRlbGV0ZSkge1xuICAgICAgICAgICAgLy8gbGlzdGVuIGZvciBjbGljayBldmVudHMgb24gcm9vdCBlbGVtZW50XG4gICAgICAgICAgICBlbGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhdGNoIGNsaWNrIGV2ZW50IGZyb20gZGVsZXRlIGJ1dHRvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGUudGFyZ2V0LmNsb3Nlc3QoXCIjZGVsZXRlXCIpO1xuICAgICAgICAgICAgICAgIGlmIChkZWxldGVCdG4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdEl0ZW0gPSBkZWxldGVCdG4uY2xvc2VzdChcIi5saXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29sbC51cGRhdGUoe3JlbW92ZTpbbGlzdEl0ZW0uaWRdfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKlxuICAgICAgICAgICAgcmVuZGVyIGluaXRpYWwgc3RhdGVcbiAgICAgICAgKi8gXG4gICAgICAgIGNvbnN0IGRpZmZzID0gdGhpcy5fY29sbC5nZXQoKVxuICAgICAgICAgICAgLm1hcChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge2lkOml0ZW0uaWQsIG5ldzppdGVtfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuX29uY2hhbmdlKGRpZmZzKTtcbiAgICB9XG5cbiAgICBfb25jaGFuZ2UoZGlmZnMpIHtcbiAgICAgICAgY29uc3Qge3RvU3RyaW5nfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGZvciAobGV0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLm5ldykge1xuICAgICAgICAgICAgICAgIC8vIGFkZFxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiaWRcIiwgZGlmZi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChcImxpc3QtaXRlbVwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZWxlbS5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbm9kZS5pbm5lckhUTUwgPSB0b1N0cmluZyhkaWZmLm5ldyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpZmYub2xkKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgICAgICAgICAgbGV0IG5vZGUgPSB0aGlzLl9lbGVtLnF1ZXJ5U2VsZWN0b3IoYCMke2RpZmYuaWR9YCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7SUFBQTtJQUNBO0lBQ0E7SUFDQTtJQUNBOztJQUVPLFNBQVMsaUJBQWlCLEdBQUc7SUFDcEMsSUFBSSxJQUFJLFFBQVE7SUFDaEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFN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
