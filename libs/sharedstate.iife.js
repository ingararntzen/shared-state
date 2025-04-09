
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vY2xpZW50L3V0aWwuanMiLCIuLi8uLi9jbGllbnQvd3Npby5qcyIsIi4uLy4uL2NsaWVudC9jb2xsZWN0aW9uLmpzIiwiLi4vLi4vY2xpZW50L3ZhcmlhYmxlLmpzIiwiLi4vLi4vY2xpZW50L3NlcnZlcmNsb2NrLmpzIiwiLi4vLi4vY2xpZW50L3NzX2NsaWVudC5qcyIsIi4uLy4uL2NsaWVudC92aWV3ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAgICBDcmVhdGUgYSBwcm9taXNlIHdoaWNoIGNhbiBiZSByZXNvbHZlZFxuICAgIHByb2dyYW1tYXRpY2FsbHkgYnkgZXh0ZXJuYWwgY29kZS5cbiAgICBSZXR1cm4gYSBwcm9taXNlIGFuZCBhIHJlc29sdmUgZnVuY3Rpb25cbiovXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZhYmxlUHJvbWlzZSgpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHJlc29sdmVyID0gcmVzb2x2ZTtcbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXRQcm9taXNlIChtcykge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgbGV0IHRpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgfSwgbXMpO1xuICAgICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgICAgIGlmICh0aWQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmRvbV9zdHJpbmcobGVuZ3RoKSB7XG4gICAgdmFyIHRleHQgPSBcIlwiO1xuICAgIHZhciBwb3NzaWJsZSA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5elwiO1xuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICB0ZXh0ICs9IHBvc3NpYmxlLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb3NzaWJsZS5sZW5ndGgpKTtcbiAgICB9XG4gICAgcmV0dXJuIHRleHQ7XG59IiwiaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmNvbnN0IE1BWF9SRVRSSUVTID0gNDtcblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl91cmwgPSB1cmw7XG4gICAgICAgIHRoaXMuX3dzO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBnZXQgY29ubmVjdGluZygpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGluZzt9XG4gICAgZ2V0IGNvbm5lY3RlZCgpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGVkO31cbiAgICBnZXQgdXJsKCkge3JldHVybiB0aGlzLl91cmw7fVxuICAgIGdldCBvcHRpb25zKCkge3JldHVybiB0aGlzLl9vcHRpb25zO31cblxuICAgIGNvbm5lY3QoKSB7XG5cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGluZyB8fCB0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDb25uZWN0IHdoaWxlIGNvbm5lY3Rpbmcgb3IgY29ubmVjdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiVGVybWluYXRlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbm5lY3RpbmdcbiAgICAgICAgdGhpcy5fd3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuX3VybCk7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSBlID0+IHRoaXMuX29uX29wZW4oZSk7XG4gICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IGUgPT4gdGhpcy5vbl9tZXNzYWdlKGUuZGF0YSk7XG4gICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSBlID0+IHRoaXMuX29uX2Nsb3NlKGUpO1xuICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gZSA9PiB0aGlzLm9uX2Vycm9yKGUpO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3RpbmcoKTtcbiAgICB9XG5cbiAgICBfb25fb3BlbihldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgIC8vIHJlbGVhc2UgY29ubmVjdCBwcm9taXNlc1xuICAgICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgICAgICAvLyByZXNldCByZXRyaWVzIG9uIHN1Y2Nlc3NmdWwgY29ubmVjdGlvblxuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgX29uX2Nsb3NlKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMub25fZGlzY29ubmVjdChldmVudCk7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgKz0gMTtcbiAgICAgICAgaWYgKCF0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29ubmVjdCgpO1xuICAgICAgICAgICAgfSwgMTAwMCAqIHRoaXMuX3JldHJpZXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIF9pc190ZXJtaW5hdGVkKCkge1xuICAgICAgICBjb25zdCB7cmV0cmllcz1NQVhfUkVUUklFU30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAodGhpcy5fcmV0cmllcyA+PSByZXRyaWVzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVGVybWluYXRlZDogTWF4IHJldHJpZXMgcmVhY2hlZCAoJHtyZXRyaWVzfSlgKTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIG9uX2Nvbm5lY3RpbmcoKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29ubmVjdGluZyAke3RoaXMudXJsfWApO31cbiAgICB9XG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KGV2ZW50KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgUmVjZWl2ZTogJHtkYXRhfWApO31cbiAgICB9XG5cbiAgICBzZW5kKGRhdGEpIHtcbiAgICAgICAgaWYgKHRoaXMuX2Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLl93cy5zZW5kKGRhdGEpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTZW5kIGZhaWw6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VuZCBkcm9wIDogbm90IGNvbm5lY3RlZGApXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25uZWN0ZWRQcm9taXNlKCkge1xuICAgICAgICBjb25zdCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycy5wdXNoKHJlc29sdmVyKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgcmFuZG9tX3N0cmluZyB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuZXhwb3J0IGNsYXNzIENvbGxlY3Rpb24ge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxlYXNlZCBieSBzcyBjbGllbnRcbiAgICAgKi9cblxuICAgIF9zc2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAvLyBlbXB0eSBjb2xsZWN0aW9uP1xuICAgICAgICAvLyBkaXNjb25uZWN0IGZyb20gb2JzZXJ2ZXJzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBjb2xsZWN0aW9uIFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHtyZW1vdmUsIGluc2VydCwgcmVzZXQ9ZmFsc2V9ID0gY2hhbmdlcztcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlIGl0ZW1zIC0gY3JlYXRlIGRpZmZcbiAgICAgICAgaWYgKHJlc2V0KSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdGhpcy5fbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KFxuICAgICAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICAgICAge2lkOiBpdGVtLmlkLCBuZXc6dW5kZWZpbmVkLCBvbGQ6aXRlbX1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBfaWQgb2YgcmVtb3ZlKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb2xkID0gdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcC5kZWxldGUoX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3OnVuZGVmaW5lZCwgb2xkfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0IGl0ZW1zIC0gdXBkYXRlIGRpZmZcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGluc2VydCkge1xuICAgICAgICAgICAgY29uc3QgX2lkID0gaXRlbS5pZDtcbiAgICAgICAgICAgIC8vIG9sZCBmcm9tIGRpZmZfbWFwIG9yIF9tYXBcbiAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBkaWZmX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IChkaWZmICE9IHVuZGVmaW5lZCkgPyBkaWZmLm9sZCA6IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIC8vIHNldCBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5fbWFwLnNldChfaWQsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gdXBkYXRlIGRpZmYgbWFwXG4gICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6aXRlbSwgb2xkfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5X2NhbGxiYWNrcyhbLi4uZGlmZl9tYXAudmFsdWVzKCldKTtcbiAgICB9XG5cbiAgICBfbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQUExJQ0FUSU9OIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9XG4gICAgaGFzKGlkKSB7cmV0dXJuIHRoaXMuX21hcC5oYXMoaWQpfVxuICAgIGdldChpZCkge1xuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gWy4uLnRoaXMuX21hcC52YWx1ZXMoKV1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAuZ2V0KGlkKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gZGlzcGF0Y2hpbmcgdXBkYXRlIHRvIHNlcnZlclxuICAgICAqL1xuICAgIHVwZGF0ZSAoY2hhbmdlcz17fSkge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICAvLyBlbnN1cmUgdGhhdCBpbnNlcnRlZCBpdGVtcyBoYXZlIGlkc1xuICAgICAgICBjb25zdCB7aW5zZXJ0PVtdfSA9IGNoYW5nZXM7XG4gICAgICAgIGNoYW5nZXMuaW5zZXJ0ID0gaW5zZXJ0Lm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbS5pZCA9IGl0ZW0uaWQgfHwgcmFuZG9tX3N0cmluZygxMCk7XG4gICAgICAgICAgICByZXR1cm4gaXRlbTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9zc2NsaWVudC51cGRhdGUodGhpcy5fcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVnaXN0ZXIgY2FsbGJhY2tcbiAgICAqL1xuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9OyAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9OyAgICBcbn0iLCJcbi8qKlxuICogVmFyaWFibGVcbiAqIFxuICogV3JhcHBlciB0byBleHBvc2UgYSBzaW5nbGUgaWQgKGl0ZW0pIGZyb20gYSBjb2xsZWN0aW9uIGFzIGEgc3RhbmRhbG9uZSB2YXJpYWJsZVxuICogXG4gKiAtIGlmIHRoZXJlIGlzIG5vIGl0ZW0gd2l0aCBpZCBpbiBjb2xsZWN0aW9uIC0gdGhlIHZhcmlhYmxlIHdpbGwgYmUgdW5kZWZpbmVkXG4gKiAgIG9yIGhhdmUgYSBkZWZhdWx0IHZhbHVlXG4gKiAtIG90aGVyd2lzZSwgdGhlIHZhcmlhYmxlIHdpbGwgYmUgdGhlIHZhbHVlIG9mIGl0ZW0uZGF0YVxuICogXG4gKiAgRGVmYXVsdCB2YWx1ZSBpcyBnaXZlbiBpbiBvcHRpb25zIHt2YWx1ZTp9XG4gKi9cblxuZXhwb3J0IGNsYXNzIFZhcmlhYmxlIHtcblxuICAgIGNvbnN0cnVjdG9yKGNvbGwsIGlkLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmlhdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2NvbGwgPSBjb2xsO1xuICAgICAgICB0aGlzLl9pZCA9IGlkO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgLy8gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYWJsZSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5pZCA9PSB0aGlzLl9pZCkge1xuICAgICAgICAgICAgICAgIHRoaXMubm90aWZ5X2NhbGxiYWNrcyhkaWZmKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcjogaGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9O1xuICAgIFxuICAgIHJlbW92ZV9jYWxsYmFjayAoaGFuZGxlKSB7XG4gICAgICAgIGxldCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgXG4gICAgbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBcbiAgICBzZXQgKHZhbHVlKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYmxlIHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpdGVtcyA9IFt7aWQ6dGhpcy5faWQsIGRhdGE6dmFsdWV9XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGwudXBkYXRlKHtpbnNlcnQ6aXRlbXMsIHJlc2V0OmZhbHNlfSk7XG4gICAgfVxuXG4gICAgZ2V0ICgpIHtcbiAgICAgICAgaWYgKHRoaXMuX2NvbGwuaGFzKHRoaXMuX2lkKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGwuZ2V0KHRoaXMuX2lkKS5kYXRhO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX29wdGlvbnMudmFsdWU7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgc3NfY2xpZW50X3Rlcm1pbmF0ZSgpIHtcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuX2NvbGwucmVtb3ZlX2NhbGxiYWNrKHRoaXMuX2hhbmRsZSk7XG4gICAgfVxufSIsIi8vIHdlYnBhZ2UgY2xvY2sgLSBwZXJmb3JtYW5jZSBub3cgLSBzZWNvbmRzXG5jb25zdCBsb2NhbCA9IHtcbiAgICBub3c6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcGVyZm9ybWFuY2Uubm93KCkvMTAwMC4wO1xuICAgIH1cbn1cbi8vIHN5c3RlbSBjbG9jayAtIGVwb2NoIC0gc2Vjb25kc1xuY29uc3QgZXBvY2ggPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBEYXRlKCkvMTAwMC4wO1xuICAgIH1cbn1cblxuLyoqXG4gKiBDTE9DSyBnaXZlcyBlcG9jaCB2YWx1ZXMsIGJ1dCBpcyBpbXBsZW1lbnRlZFxuICogdXNpbmcgcGVyZm9ybWFuY2Ugbm93IGZvciBiZXR0ZXJcbiAqIHRpbWUgcmVzb2x1dGlvbiBhbmQgcHJvdGVjdGlvbiBhZ2FpbnN0IHN5c3RlbSBcbiAqIHRpbWUgYWRqdXN0bWVudHMuXG4gKi9cblxuY29uc3QgQ0xPQ0sgPSBmdW5jdGlvbiAoKSB7XG4gICAgY29uc3QgdDBfbG9jYWwgPSBsb2NhbC5ub3coKTtcbiAgICBjb25zdCB0MF9lcG9jaCA9IGVwb2NoLm5vdygpO1xuICAgIHJldHVybiB7XG4gICAgICAgIG5vdzogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY29uc3QgdDFfbG9jYWwgPSBsb2NhbC5ub3coKTtcbiAgICAgICAgICAgIHJldHVybiB0MF9lcG9jaCArICh0MV9sb2NhbCAtIHQwX2xvY2FsKTtcbiAgICAgICAgfVxuICAgIH07XG59KCk7XG5cblxuLyoqXG4gKiBFc3RpbWF0ZSB0aGUgY2xvY2sgb2YgdGhlIHNlcnZlciBcbiAqL1xuXG5jb25zdCBNQVhfU0FNUExFX0NPVU5UID0gMzA7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXJDbG9jayB7XG5cbiAgICBjb25zdHJ1Y3Rvcihzc2NsaWVudCkge1xuICAgICAgICAvLyBzaGFyZXN0YXRlIGNsaWVudFxuICAgICAgICB0aGlzLl9zc2NsaWVudCA9IHNzY2xpZW50O1xuICAgICAgICAvLyBwaW5nZXJcbiAgICAgICAgdGhpcy5fcGluZ2VyID0gbmV3IFBpbmdlcih0aGlzLl9vbnBpbmcuYmluZCh0aGlzKSk7XG4gICAgICAgIC8vIHNhbXBsZXNcbiAgICAgICAgdGhpcy5fc2FtcGxlcyA9IFtdO1xuICAgICAgICAvLyBlc3RpbWF0ZXNcbiAgICAgICAgdGhpcy5fdHJhbnMgPSAxMDAwLjA7XG4gICAgICAgIHRoaXMuX3NrZXcgPSAwLjA7XG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICB0aGlzLl9waW5nZXIucmVzdW1lKCk7XG4gICAgfVxuXG4gICAgcGF1c2UoKSB7XG4gICAgICAgIHRoaXMuX3Bpbmdlci5wYXVzZSgpO1xuICAgIH1cblxuICAgIF9vbnBpbmcoKSB7XG4gICAgICAgIGNvbnN0IHRzMCA9IENMT0NLLm5vdygpO1xuICAgICAgICB0aGlzLl9zc2NsaWVudC5nZXQoXCIvY2xvY2tcIikudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgaWYgKG9rKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHMxID0gQ0xPQ0subm93KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fYWRkX3NhbXBsZSh0czAsIGRhdGEsIHRzMSk7ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfYWRkX3NhbXBsZShjcywgc3MsIGNyKSB7XG4gICAgICAgIGxldCB0cmFucyA9IChjciAtIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNrZXcgPSBzcyAtIChjciArIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNhbXBsZSA9IFtjcywgc3MsIGNyLCB0cmFucywgc2tld107XG4gICAgICAgIC8vIGFkZCB0byBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMucHVzaChzYW1wbGUpXG4gICAgICAgIGlmICh0aGlzLl9zYW1wbGVzLmxlbmd0aCA+IE1BWF9TQU1QTEVfQ09VTlQpIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZSBmaXJzdCBzYW1wbGVcbiAgICAgICAgICAgIHRoaXMuX3NhbXBsZXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZWV2YWx1YXRlIGVzdGltYXRlcyBmb3Igc2tldyBhbmQgdHJhbnNcbiAgICAgICAgdHJhbnMgPSAxMDAwMDAuMDtcbiAgICAgICAgc2tldyA9IDAuMDtcbiAgICAgICAgZm9yIChjb25zdCBzYW1wbGUgb2YgdGhpcy5fc2FtcGxlcykge1xuICAgICAgICAgICAgaWYgKHNhbXBsZVszXSA8IHRyYW5zKSB7XG4gICAgICAgICAgICAgICAgdHJhbnMgPSBzYW1wbGVbM107XG4gICAgICAgICAgICAgICAgc2tldyA9IHNhbXBsZVs0XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9za2V3ID0gc2tldztcbiAgICAgICAgdGhpcy5fdHJhbnMgPSB0cmFucztcbiAgICB9XG5cbiAgICBnZXQgc2tldygpIHtyZXR1cm4gdGhpcy5fc2tldzt9XG4gICAgZ2V0IHRyYW5zKCkge3JldHVybiB0aGlzLl90cmFuczt9XG5cbiAgICBub3coKSB7XG4gICAgICAgIC8vIHNlcnZlciBjbG9jayBpcyBsb2NhbCBjbG9jayArIGVzdGltYXRlZCBza2V3XG4gICAgICAgIHJldHVybiBDTE9DSy5ub3coKSArIHRoaXMuX3NrZXc7XG4gICAgfVxuXG59XG5cblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgIFBJTkdFUlxuKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuLyoqXG4gKiBQaW5nZXIgaW52b2tlcyBhIGNhbGxiYWNrIHJlcGVhdGVkbHksIGluZGVmaW5pdGVseS4gXG4gKiBQaW5naW5nIGluIDMgc3RhZ2VzLCBmaXJzdCBmcmVxdWVudGx5LCB0aGVuIG1vZGVyYXRlbHksIFxuICogdGhlbiBzbG93bHkuXG4gKi9cblxuY29uc3QgU01BTExfREVMQVkgPSAyMDsgLy8gbXNcbmNvbnN0IE1FRElVTV9ERUxBWSA9IDUwMDsgLy8gbXNcbmNvbnN0IExBUkdFX0RFTEFZID0gMTAwMDA7IC8vIG1zXG5cbmNvbnN0IERFTEFZX1NFUVVFTkNFID0gW1xuICAgIC4uLm5ldyBBcnJheSgzKS5maWxsKFNNQUxMX0RFTEFZKSwgXG4gICAgLi4ubmV3IEFycmF5KDcpLmZpbGwoTUVESVVNX0RFTEFZKSxcbiAgICAuLi5bTEFSR0VfREVMQVldXG5dO1xuXG5jbGFzcyBQaW5nZXIge1xuXG4gICAgY29uc3RydWN0b3IgKGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuX2NvdW50ID0gMDtcbiAgICAgICAgdGhpcy5fdGlkID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICAgICAgICB0aGlzLl9waW5nID0gdGhpcy5waW5nLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuX2RlbGF5cyA9IFsuLi5ERUxBWV9TRVFVRU5DRV07XG4gICAgfVxuICAgIHBhdXNlKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICB9XG4gICAgcmVzdW1lKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHJlc3RhcnQoKSB7XG4gICAgICAgIHRoaXMuX2RlbGF5cyA9IFsuLi5ERUxBWV9TRVFVRU5DRV07XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgICAgICB0aGlzLnBpbmcoKTtcbiAgICB9XG4gICAgcGluZyAoKSB7XG4gICAgICAgIGxldCBuZXh0X2RlbGF5ID0gdGhpcy5fZGVsYXlzWzBdO1xuICAgICAgICBpZiAodGhpcy5fZGVsYXlzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMuX2RlbGF5cy5zaGlmdCgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9jYWxsYmFjaykge1xuICAgICAgICAgICAgdGhpcy5fY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl90aWQgPSBzZXRUaW1lb3V0KHRoaXMuX3BpbmcsIG5leHRfZGVsYXkpO1xuICAgIH1cbn1cblxuXG4iLCJpbXBvcnQgeyBXZWJTb2NrZXRJTyB9IGZyb20gXCIuL3dzaW8uanNcIjtcbmltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuaW1wb3J0IHsgQ29sbGVjdGlvbiB9IGZyb20gXCIuL2NvbGxlY3Rpb24uanNcIjtcbmltcG9ydCB7IFZhcmlhYmxlIH0gZnJvbSBcIi4vdmFyaWFibGUuanNcIjtcbmltcG9ydCB7IFNlcnZlckNsb2NrIH0gZnJvbSBcIi4vc2VydmVyY2xvY2suanNcIjtcblxuY29uc3QgTXNnVHlwZSA9IE9iamVjdC5mcmVlemUoe1xuICAgIE1FU1NBR0UgOiBcIk1FU1NBR0VcIixcbiAgICBSRVFVRVNUOiBcIlJFUVVFU1RcIixcbiAgICBSRVBMWTogXCJSRVBMWVwiXG4gfSk7XG4gXG5jb25zdCBNc2dDbWQgPSBPYmplY3QuZnJlZXplKHtcbiAgICBHRVQgOiBcIkdFVFwiLFxuICAgIFBVVDogXCJQVVRcIixcbiAgICBOT1RJRlk6IFwiTk9USUZZXCJcbn0pO1xuXG5cbmV4cG9ydCBjbGFzcyBTaGFyZWRTdGF0ZUNsaWVudCBleHRlbmRzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yICh1cmwsIG9wdGlvbnMpIHtcbiAgICAgICAgc3VwZXIodXJsLCBvcHRpb25zKTtcblxuICAgICAgICAvLyByZXF1ZXN0c1xuICAgICAgICB0aGlzLl9yZXFpZCA9IDA7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc3Vic2NyaXB0aW9uc1xuICAgICAgICAvLyBwYXRoIC0+IHt9IFxuICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBjb2xsZWN0aW9ucyB7cGF0aCAtPiBjb2xsZWN0aW9ufVxuICAgICAgICB0aGlzLl9jb2xsX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyB2YXJpYWJsZXMge1twYXRoLCBpZF0gLT4gdmFyaWFibGV9XG4gICAgICAgIHRoaXMuX3Zhcl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jaztcblxuICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIENPTk5FQ1RJT04gXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHJlZnJlc2ggbG9jYWwgc3VzY3JpcHRpb25zXG4gICAgICAgIGlmICh0aGlzLl9zdWJzX21hcC5zaXplID4gMCkge1xuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3VtZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9uX2Rpc2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucGF1c2UoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbW11bmljYXRpb24gRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgSEFORExFUlNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgbGV0IG1zZyA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLlJFUExZKSB7XG4gICAgICAgICAgICBsZXQgcmVxaWQgPSBtc2cudHVubmVsO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmcuaGFzKHJlcWlkKSkge1xuICAgICAgICAgICAgICAgIGxldCByZXNvbHZlciA9IHRoaXMuX3BlbmRpbmcuZ2V0KHJlcWlkKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nLmRlbGV0ZShyZXFpZCk7XG4gICAgICAgICAgICAgICAgY29uc3Qge29rLCBkYXRhfSA9IG1zZztcbiAgICAgICAgICAgICAgICByZXNvbHZlcih7b2ssIGRhdGF9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLk1FU1NBR0UpIHtcbiAgICAgICAgICAgIGlmIChtc2cuY21kID09IE1zZ0NtZC5OT1RJRlkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVfbm90aWZ5KG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX25vdGlmeShtc2cpIHtcbiAgICAgICAgLy8gdXBkYXRlIGNvbGxlY3Rpb24gc3RhdGVcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9jb2xsX21hcC5nZXQobXNnW1wicGF0aFwiXSk7XG4gICAgICAgIGlmIChkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRzLl9zc2NsaWVudF91cGRhdGUobXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNFUlZFUiBSRVFVRVNUU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIF9yZXF1ZXN0KGNtZCwgcGF0aCwgYXJnKSB7XG4gICAgICAgIGNvbnN0IHJlcWlkID0gdGhpcy5fcmVxaWQrKztcbiAgICAgICAgY29uc3QgbXNnID0ge1xuICAgICAgICAgICAgdHlwZTogTXNnVHlwZS5SRVFVRVNULFxuICAgICAgICAgICAgY21kLCBcbiAgICAgICAgICAgIHBhdGgsIFxuICAgICAgICAgICAgYXJnLFxuICAgICAgICAgICAgdHVubmVsOiByZXFpZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlbmQoSlNPTi5zdHJpbmdpZnkobXNnKSk7XG4gICAgICAgIGxldCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgdGhpcy5fcGVuZGluZy5zZXQocmVxaWQsIHJlc29sdmVyKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgLy8gc3BlY2lhbCBoYW5kbGluZyBmb3IgcmVwbGllcyB0byBQVVQgL3N1YnNcbiAgICAgICAgICAgIGlmIChjbWQgPT0gTXNnQ21kLlBVVCAmJiBwYXRoID09IFwiL3N1YnNcIiAmJiBvaykge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzY3JpcHRpb24gc3RhdGVcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoZGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7b2ssIHBhdGgsIGRhdGF9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfc3ViIChwYXRoKSB7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgICAgIC8vIHNldCBuZXcgcGF0aFxuICAgICAgICAgICAgc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnMgLSBzdWJzY3JpYmUgb24gcmVjb25uZWN0XG4gICAgICAgICAgICB0aGlzLl9zdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7b2s6IHRydWUsIHBhdGgsIGRhdGE6dW5kZWZpbmVkfSlcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgX3Vuc3ViIChwYXRoKSB7XG4gICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgLy8gcmVtb3ZlIHBhdGhcbiAgICAgICAgc3Vic19tYXAuZGVsZXRlKHBhdGgpXG4gICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnN1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8vIGFjY3Nlc3NvciBmb3Igc2VydmVyIGNsb2NrXG4gICAgZ2V0IGNsb2NrKCkge1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrID0gbmV3IFNlcnZlckNsb2NrKHRoaXMpO1xuICAgICAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3VtZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9zZXJ2ZXJfY2xvY2s7XG4gICAgfVxuXG4gICAgLy8gZ2V0IHJlcXVlc3QgZm9yIGl0ZW1zIGJ5IHBhdGhcbiAgICBnZXQocGF0aCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuR0VULCBwYXRoKTtcbiAgICB9XG4gICAgXG4gICAgLy8gdXBkYXRlIHJlcXVlc3QgZm9yIHBhdGhcbiAgICB1cGRhdGUocGF0aCwgY2hhbmdlcykge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuUFVULCBwYXRoLCBjaGFuZ2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIGNvbGxlY3Rpb24gZm9yIHBhdGhcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlcyB0byBwYXRoIGlmIG5lZWRlZFxuICAgICAqL1xuICAgIGFjcXVpcmVfY29sbGVjdGlvbiAocGF0aCwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBzdWJzY3JpcHRpb24gZG9lcyBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBjb2xsZWN0aW9uIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9jb2xsX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2NvbGxfbWFwLnNldChwYXRoLCBuZXcgQ29sbGVjdGlvbih0aGlzLCBwYXRoLCBvcHRpb25zKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIHZhcmlhYmxlIGZvciAocGF0aCwgbmFtZSlcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgYWNxdWlyZSBjb2xsZWN0aW9uXG4gICAgICovXG4gICAgYWNxdWlyZV92YXJpYWJsZSAocGF0aCwgbmFtZSwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5hY3F1aXJlX2NvbGxlY3Rpb24ocGF0aCk7XG4gICAgICAgIC8vIGNyZWF0ZSB2YXJpYWJsZSBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fdmFyX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX3Zhcl9tYXAuc2V0KHBhdGgsIG5ldyBNYXAoKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgdmFyX21hcCA9IHRoaXMuX3Zhcl9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAoIXZhcl9tYXAuZ2V0KG5hbWUpKSB7XG4gICAgICAgICAgICB2YXJfbWFwLnNldChuYW1lLCBuZXcgVmFyaWFibGUoZHMsIG5hbWUsIG9wdGlvbnMpKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB2YXJfbWFwLmdldChuYW1lKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHJlbGVhc2UgcGF0aCwgaW5jbHVkaW5nIGNvbGxlY3Rpb24gYW5kIHZhcmlhYmxlc1xuICAgICAqL1xuICAgIHJlbGVhc2UocGF0aCkge1xuICAgICAgICAvLyB1bnN1YnNjcmliZVxuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl91bnN1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyB0ZXJtaW5hdGUgY29sbGVjdGlvbiBhbmQgdmFyaWFibGVzXG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fY29sbF9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBkcy5fc3NjbGllbnRfdGVybWluYXRlKCk7XG4gICAgICAgIGNvbnN0IHZhcl9tYXAgPSB0aGlzLl92YXJfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKHZhcl9tYXAgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHYgb2YgdmFyX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIHYuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICAgICAgfSAgICBcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb2xsX21hcC5kZWxldGUocGF0aCk7XG4gICAgICAgIHRoaXMuX3Zhcl9tYXAuZGVsZXRlKHBhdGgpO1xuICAgIH1cbn1cblxuXG4iLCIvKlxuICAgIENvbGxlY3Rpb24gVmlld2VyXG4qL1xuXG5mdW5jdGlvbiBpdGVtMnN0cmluZyhpdGVtKSB7XG4gICAgY29uc3Qge2lkLCBpdHYsIGRhdGF9ID0gaXRlbTtcbiAgICBsZXQgZGF0YV90eHQgPSBKU09OLnN0cmluZ2lmeShkYXRhKTtcbiAgICBsZXQgaXR2X3R4dCA9IChpdHYgIT0gdW5kZWZpbmVkKSA/IEpTT04uc3RyaW5naWZ5KGl0dikgOiBcIlwiO1xuICAgIGxldCBpZF9odG1sID0gYDxzcGFuIGNsYXNzPVwiaWRcIj4ke2lkfTwvc3Bhbj5gO1xuICAgIGxldCBpdHZfaHRtbCA9IGA8c3BhbiBjbGFzcz1cIml0dlwiPiR7aXR2X3R4dH08L3NwYW4+YDtcbiAgICBsZXQgZGF0YV9odG1sID0gYDxzcGFuIGNsYXNzPVwiZGF0YVwiPiR7ZGF0YV90eHR9PC9zcGFuPmA7XG4gICAgcmV0dXJuIGBcbiAgICAgICAgPGRpdj5cbiAgICAgICAgICAgIDxidXR0b24gaWQ9XCJkZWxldGVcIj5YPC9idXR0b24+XG4gICAgICAgICAgICAke2lkX2h0bWx9OiAke2l0dl9odG1sfSAke2RhdGFfaHRtbH1cbiAgICAgICAgPC9kaXY+YDtcbn1cblxuXG5leHBvcnQgY2xhc3MgQ29sbGVjdGlvblZpZXdlciB7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb2xsZWN0aW9uLCBlbGVtLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX2NvbGwgPSBjb2xsZWN0aW9uO1xuICAgICAgICB0aGlzLl9lbGVtID0gZWxlbTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7IFxuXG4gICAgICAgIC8vIG9wdGlvbnNcbiAgICAgICAgbGV0IGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgZGVsZXRlOmZhbHNlLFxuICAgICAgICAgICAgdG9TdHJpbmc6aXRlbTJzdHJpbmdcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHsuLi5kZWZhdWx0cywgLi4ub3B0aW9uc307XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIFN1cHBvcnQgZGVsZXRlXG4gICAgICAgICovXG4gICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmRlbGV0ZSkge1xuICAgICAgICAgICAgLy8gbGlzdGVuIGZvciBjbGljayBldmVudHMgb24gcm9vdCBlbGVtZW50XG4gICAgICAgICAgICBlbGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhdGNoIGNsaWNrIGV2ZW50IGZyb20gZGVsZXRlIGJ1dHRvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGUudGFyZ2V0LmNsb3Nlc3QoXCIjZGVsZXRlXCIpO1xuICAgICAgICAgICAgICAgIGlmIChkZWxldGVCdG4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdEl0ZW0gPSBkZWxldGVCdG4uY2xvc2VzdChcIi5saXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29sbC51cGRhdGUoe3JlbW92ZTpbbGlzdEl0ZW0uaWRdfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKlxuICAgICAgICAgICAgcmVuZGVyIGluaXRpYWwgc3RhdGVcbiAgICAgICAgKi8gXG4gICAgICAgIGNvbnN0IGRpZmZzID0gdGhpcy5fY29sbC5nZXQoKVxuICAgICAgICAgICAgLm1hcChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge2lkOml0ZW0uaWQsIG5ldzppdGVtfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuX29uY2hhbmdlKGRpZmZzKTtcbiAgICB9XG5cbiAgICBfb25jaGFuZ2UoZGlmZnMpIHtcbiAgICAgICAgY29uc3Qge3RvU3RyaW5nfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGZvciAobGV0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLm5ldykge1xuICAgICAgICAgICAgICAgIC8vIGFkZFxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiaWRcIiwgZGlmZi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChcImxpc3QtaXRlbVwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZWxlbS5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbm9kZS5pbm5lckhUTUwgPSB0b1N0cmluZyhkaWZmLm5ldyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpZmYub2xkKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgICAgICAgICAgbGV0IG5vZGUgPSB0aGlzLl9lbGVtLnF1ZXJ5U2VsZWN0b3IoYCMke2RpZmYuaWR9YCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7OztJQUFBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7O0lBRU8sU0FBUyxpQkFBaUIsR0FBRztJQUNwQyxJQUFJLElBQUksUUFBUTtJQUNoQixJQUFJLElBQUksT0FBTyxHQUFHLElBQUksT0FBTyxDQUFDLENBQUMsT0FBTyxFQUFFLE1B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
