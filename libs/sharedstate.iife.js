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
     * Proxy Object
     * 
     * Client-side proxy object for a server-side object.
     *
     * Implementation leverages ProxyCollection. As such, the value of the proxy object
     * corresponds to the data property of a single item with *id* within a 
     * specific server-side collection. If no item with *id* exists in the collection, the
     * value of the proxy object is undefined. 
     * 
     * set() and get() methods are used to set and get the value of the proxy object.
     * 
     */

    class ProxyObject {

        constructor(proxyCollection, id, options={}) {
            this._terminiated = false;
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
                this._handers.splice(index, 1);
            }
        };
        
        notify_callbacks (eArg) {
            this._handlers.forEach(function(handle) {
                handle.handler(eArg);
            });
        };

        
        set (obj) {
            if (this._terminated) {
                throw new Error("proxy object terminated")
            }
            const items = [{id:this._id, data:obj}];
            return this._coll.update({insert:items, reset:false});
        }

        get () {
            if (this._coll.has(this._id)) {
                return this._coll.get(this._id).data;
            } else {
                return undefined;
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
            ds._ssclient_terminate();
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vY2xpZW50L3V0aWwuanMiLCIuLi8uLi9jbGllbnQvd3Npby5qcyIsIi4uLy4uL2NsaWVudC9zc19jb2xsZWN0aW9uLmpzIiwiLi4vLi4vY2xpZW50L3NzX29iamVjdC5qcyIsIi4uLy4uL2NsaWVudC9zZXJ2ZXJjbG9jay5qcyIsIi4uLy4uL2NsaWVudC9zc19jbGllbnQuanMiLCIuLi8uLi9jbGllbnQvdmlld2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gICAgQ3JlYXRlIGEgcHJvbWlzZSB3aGljaCBjYW4gYmUgcmVzb2x2ZWRcbiAgICBwcm9ncmFtbWF0aWNhbGx5IGJ5IGV4dGVybmFsIGNvZGUuXG4gICAgUmV0dXJuIGEgcHJvbWlzZSBhbmQgYSByZXNvbHZlIGZ1bmN0aW9uXG4qL1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2YWJsZVByb21pc2UoKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICByZXNvbHZlciA9IHJlc29sdmU7XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0UHJvbWlzZSAobXMpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGxldCB0aWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgIH0sIG1zKTtcbiAgICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGlkKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByYW5kb21fc3RyaW5nKGxlbmd0aCkge1xuICAgIHZhciB0ZXh0ID0gXCJcIjtcbiAgICB2YXIgcG9zc2libGUgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpcIjtcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGV4dCArPSBwb3NzaWJsZS5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9zc2libGUubGVuZ3RoKSk7XG4gICAgfVxuICAgIHJldHVybiB0ZXh0O1xufSIsImltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuXG5jb25zdCBNQVhfUkVUUklFUyA9IDQ7XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdXJsID0gdXJsO1xuICAgICAgICB0aGlzLl93cztcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgfVxuXG4gICAgZ2V0IGNvbm5lY3RpbmcoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3Rpbmc7fVxuICAgIGdldCBjb25uZWN0ZWQoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3RlZDt9XG4gICAgZ2V0IHVybCgpIHtyZXR1cm4gdGhpcy5fdXJsO31cbiAgICBnZXQgb3B0aW9ucygpIHtyZXR1cm4gdGhpcy5fb3B0aW9uczt9XG5cbiAgICBjb25uZWN0KCkge1xuXG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RpbmcgfHwgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ29ubmVjdCB3aGlsZSBjb25uZWN0aW5nIG9yIGNvbm5lY3RlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIlRlcm1pbmF0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25uZWN0aW5nXG4gICAgICAgIHRoaXMuX3dzID0gbmV3IFdlYlNvY2tldCh0aGlzLl91cmwpO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gZSA9PiB0aGlzLl9vbl9vcGVuKGUpO1xuICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSBlID0+IHRoaXMub25fbWVzc2FnZShlLmRhdGEpO1xuICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gZSA9PiB0aGlzLl9vbl9jbG9zZShlKTtcbiAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IGUgPT4gdGhpcy5vbl9lcnJvcihlKTtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0aW5nKCk7XG4gICAgfVxuXG4gICAgX29uX29wZW4oZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAvLyByZWxlYXNlIGNvbm5lY3QgcHJvbWlzZXNcbiAgICAgICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICAgICAgLy8gcmVzZXQgcmV0cmllcyBvbiBzdWNjZXNzZnVsIGNvbm5lY3Rpb25cbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMub25fY29ubmVjdCgpO1xuICAgIH1cblxuICAgIF9vbl9jbG9zZShldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLm9uX2Rpc2Nvbm5lY3QoZXZlbnQpO1xuICAgICAgICB0aGlzLl9yZXRyaWVzICs9IDE7XG4gICAgICAgIGlmICghdGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICAgICAgICAgIH0sIDEwMDAgKiB0aGlzLl9yZXRyaWVzKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBfaXNfdGVybWluYXRlZCgpIHtcbiAgICAgICAgY29uc3Qge3JldHJpZXM9TUFYX1JFVFJJRVN9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKHRoaXMuX3JldHJpZXMgPj0gcmV0cmllcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFRlcm1pbmF0ZWQ6IE1heCByZXRyaWVzIHJlYWNoZWQgKCR7cmV0cmllc30pYCk7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cyA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBvbl9jb25uZWN0aW5nKCkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbm5lY3RpbmcgJHt0aGlzLnVybH1gKTt9XG4gICAgfVxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdChldmVudCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYFJlY2VpdmU6ICR7ZGF0YX1gKTt9XG4gICAgfVxuXG4gICAgc2VuZChkYXRhKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fd3Muc2VuZChkYXRhKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU2VuZCBmYWlsOiAke2Vycm9yfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbmQgZHJvcCA6IG5vdCBjb25uZWN0ZWRgKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29ubmVjdGVkUHJvbWlzZSgpIHtcbiAgICAgICAgY29uc3QgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMucHVzaChyZXNvbHZlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IHJhbmRvbV9zdHJpbmcgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm94eUNvbGxlY3Rpb24ge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxlYXNlZCBieSBzcyBjbGllbnRcbiAgICAgKi9cblxuICAgIF9zc2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAvLyBlbXB0eSBjb2xsZWN0aW9uP1xuICAgICAgICAvLyBkaXNjb25uZWN0IGZyb20gb2JzZXJ2ZXJzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBjb2xsZWN0aW9uIFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHtyZW1vdmUsIGluc2VydCwgcmVzZXQ9ZmFsc2V9ID0gY2hhbmdlcztcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlIGl0ZW1zIC0gY3JlYXRlIGRpZmZcbiAgICAgICAgaWYgKHJlc2V0KSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdGhpcy5fbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KFxuICAgICAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICAgICAge2lkOiBpdGVtLmlkLCBuZXc6dW5kZWZpbmVkLCBvbGQ6aXRlbX1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBfaWQgb2YgcmVtb3ZlKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb2xkID0gdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcC5kZWxldGUoX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3OnVuZGVmaW5lZCwgb2xkfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0IGl0ZW1zIC0gdXBkYXRlIGRpZmZcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGluc2VydCkge1xuICAgICAgICAgICAgY29uc3QgX2lkID0gaXRlbS5pZDtcbiAgICAgICAgICAgIC8vIG9sZCBmcm9tIGRpZmZfbWFwIG9yIF9tYXBcbiAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBkaWZmX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IChkaWZmICE9IHVuZGVmaW5lZCkgPyBkaWZmLm9sZCA6IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIC8vIHNldCBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5fbWFwLnNldChfaWQsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gdXBkYXRlIGRpZmYgbWFwXG4gICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6aXRlbSwgb2xkfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5X2NhbGxiYWNrcyhbLi4uZGlmZl9tYXAudmFsdWVzKCldKTtcbiAgICB9XG5cbiAgICBfbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQUExJQ0FUSU9OIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9XG4gICAgaGFzKGlkKSB7cmV0dXJuIHRoaXMuX21hcC5oYXMoaWQpfVxuICAgIGdldChpZCkge1xuICAgICAgICBpZiAoaWQgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICByZXR1cm4gWy4uLnRoaXMuX21hcC52YWx1ZXMoKV1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9tYXAuZ2V0KGlkKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gZGlzcGF0Y2hpbmcgdXBkYXRlIHRvIHNlcnZlclxuICAgICAqL1xuICAgIHVwZGF0ZSAoY2hhbmdlcz17fSkge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICAvLyBlbnN1cmUgdGhhdCBpbnNlcnRlZCBpdGVtcyBoYXZlIGlkc1xuICAgICAgICBjb25zdCB7aW5zZXJ0PVtdfSA9IGNoYW5nZXM7XG4gICAgICAgIGNoYW5nZXMuaW5zZXJ0ID0gaW5zZXJ0Lm1hcCgoaXRlbSkgPT4ge1xuICAgICAgICAgICAgaXRlbS5pZCA9IGl0ZW0uaWQgfHwgcmFuZG9tX3N0cmluZygxMCk7XG4gICAgICAgICAgICByZXR1cm4gaXRlbTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybiB0aGlzLl9zc2NsaWVudC51cGRhdGUodGhpcy5fcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVnaXN0ZXIgY2FsbGJhY2tcbiAgICAqL1xuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9OyAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9OyAgICBcbn0iLCJcbi8qKlxuICogUHJveHkgT2JqZWN0XG4gKiBcbiAqIENsaWVudC1zaWRlIHByb3h5IG9iamVjdCBmb3IgYSBzZXJ2ZXItc2lkZSBvYmplY3QuXG4gKlxuICogSW1wbGVtZW50YXRpb24gbGV2ZXJhZ2VzIFByb3h5Q29sbGVjdGlvbi4gQXMgc3VjaCwgdGhlIHZhbHVlIG9mIHRoZSBwcm94eSBvYmplY3RcbiAqIGNvcnJlc3BvbmRzIHRvIHRoZSBkYXRhIHByb3BlcnR5IG9mIGEgc2luZ2xlIGl0ZW0gd2l0aCAqaWQqIHdpdGhpbiBhIFxuICogc3BlY2lmaWMgc2VydmVyLXNpZGUgY29sbGVjdGlvbi4gSWYgbm8gaXRlbSB3aXRoICppZCogZXhpc3RzIGluIHRoZSBjb2xsZWN0aW9uLCB0aGVcbiAqIHZhbHVlIG9mIHRoZSBwcm94eSBvYmplY3QgaXMgdW5kZWZpbmVkLiBcbiAqIFxuICogc2V0KCkgYW5kIGdldCgpIG1ldGhvZHMgYXJlIHVzZWQgdG8gc2V0IGFuZCBnZXQgdGhlIHZhbHVlIG9mIHRoZSBwcm94eSBvYmplY3QuXG4gKiBcbiAqL1xuXG5leHBvcnQgY2xhc3MgUHJveHlPYmplY3Qge1xuXG4gICAgY29uc3RydWN0b3IocHJveHlDb2xsZWN0aW9uLCBpZCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl90ZXJtaW5pYXRlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb2xsID0gcHJveHlDb2xsZWN0aW9uO1xuICAgICAgICB0aGlzLl9pZCA9IGlkO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgLy8gY2FsbGJhY2tcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwcm94eSBvYmplY3QgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZGlmZiBvZiBkaWZmcykge1xuICAgICAgICAgICAgaWYgKGRpZmYuaWQgPT0gdGhpcy5faWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeV9jYWxsYmFja3MoZGlmZik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXI6IGhhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcbiAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9O1xuICAgIFxuICAgIG5vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgXG4gICAgc2V0IChvYmopIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInByb3h5IG9iamVjdCB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaXRlbXMgPSBbe2lkOnRoaXMuX2lkLCBkYXRhOm9ian1dO1xuICAgICAgICByZXR1cm4gdGhpcy5fY29sbC51cGRhdGUoe2luc2VydDppdGVtcywgcmVzZXQ6ZmFsc2V9KTtcbiAgICB9XG5cbiAgICBnZXQgKCkge1xuICAgICAgICBpZiAodGhpcy5fY29sbC5oYXModGhpcy5faWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY29sbC5nZXQodGhpcy5faWQpLmRhdGE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHNzX2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLl9jb2xsLnJlbW92ZV9jYWxsYmFjayh0aGlzLl9oYW5kbGUpO1xuICAgIH1cbn0iLCIvLyB3ZWJwYWdlIGNsb2NrIC0gcGVyZm9ybWFuY2Ugbm93IC0gc2Vjb25kc1xuY29uc3QgbG9jYWwgPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHBlcmZvcm1hbmNlLm5vdygpLzEwMDAuMDtcbiAgICB9XG59XG4vLyBzeXN0ZW0gY2xvY2sgLSBlcG9jaCAtIHNlY29uZHNcbmNvbnN0IGVwb2NoID0ge1xuICAgIG5vdzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuZXcgRGF0ZSgpLzEwMDAuMDtcbiAgICB9XG59XG5cbi8qKlxuICogQ0xPQ0sgZ2l2ZXMgZXBvY2ggdmFsdWVzLCBidXQgaXMgaW1wbGVtZW50ZWRcbiAqIHVzaW5nIHBlcmZvcm1hbmNlIG5vdyBmb3IgYmV0dGVyXG4gKiB0aW1lIHJlc29sdXRpb24gYW5kIHByb3RlY3Rpb24gYWdhaW5zdCBzeXN0ZW0gXG4gKiB0aW1lIGFkanVzdG1lbnRzLlxuICovXG5cbmNvbnN0IENMT0NLID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbnN0IHQwX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgY29uc3QgdDBfZXBvY2ggPSBlcG9jaC5ub3coKTtcbiAgICByZXR1cm4ge1xuICAgICAgICBub3c6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGNvbnN0IHQxX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgICAgICAgICByZXR1cm4gdDBfZXBvY2ggKyAodDFfbG9jYWwgLSB0MF9sb2NhbCk7XG4gICAgICAgIH1cbiAgICB9O1xufSgpO1xuXG5cbi8qKlxuICogRXN0aW1hdGUgdGhlIGNsb2NrIG9mIHRoZSBzZXJ2ZXIgXG4gKi9cblxuY29uc3QgTUFYX1NBTVBMRV9DT1VOVCA9IDMwO1xuXG5leHBvcnQgY2xhc3MgU2VydmVyQ2xvY2sge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQpIHtcbiAgICAgICAgLy8gc2hhcmVzdGF0ZSBjbGllbnRcbiAgICAgICAgdGhpcy5fc3NjbGllbnQgPSBzc2NsaWVudDtcbiAgICAgICAgLy8gcGluZ2VyXG4gICAgICAgIHRoaXMuX3BpbmdlciA9IG5ldyBQaW5nZXIodGhpcy5fb25waW5nLmJpbmQodGhpcykpO1xuICAgICAgICAvLyBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMgPSBbXTtcbiAgICAgICAgLy8gZXN0aW1hdGVzXG4gICAgICAgIHRoaXMuX3RyYW5zID0gMTAwMC4wO1xuICAgICAgICB0aGlzLl9za2V3ID0gMC4wO1xuICAgIH1cblxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgdGhpcy5fcGluZ2VyLnJlc3VtZSgpO1xuICAgIH1cblxuICAgIHBhdXNlKCkge1xuICAgICAgICB0aGlzLl9waW5nZXIucGF1c2UoKTtcbiAgICB9XG5cbiAgICBfb25waW5nKCkge1xuICAgICAgICBjb25zdCB0czAgPSBDTE9DSy5ub3coKTtcbiAgICAgICAgdGhpcy5fc3NjbGllbnQuZ2V0KFwiL2Nsb2NrXCIpLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIGlmIChvaykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRzMSA9IENMT0NLLm5vdygpO1xuICAgICAgICAgICAgICAgIHRoaXMuX2FkZF9zYW1wbGUodHMwLCBkYXRhLCB0czEpOyAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX2FkZF9zYW1wbGUoY3MsIHNzLCBjcikge1xuICAgICAgICBsZXQgdHJhbnMgPSAoY3IgLSBjcykgLyAyLjA7XG4gICAgICAgIGxldCBza2V3ID0gc3MgLSAoY3IgKyBjcykgLyAyLjA7XG4gICAgICAgIGxldCBzYW1wbGUgPSBbY3MsIHNzLCBjciwgdHJhbnMsIHNrZXddO1xuICAgICAgICAvLyBhZGQgdG8gc2FtcGxlc1xuICAgICAgICB0aGlzLl9zYW1wbGVzLnB1c2goc2FtcGxlKVxuICAgICAgICBpZiAodGhpcy5fc2FtcGxlcy5sZW5ndGggPiBNQVhfU0FNUExFX0NPVU5UKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgZmlyc3Qgc2FtcGxlXG4gICAgICAgICAgICB0aGlzLl9zYW1wbGVzLnNoaWZ0KCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gcmVldmFsdWF0ZSBlc3RpbWF0ZXMgZm9yIHNrZXcgYW5kIHRyYW5zXG4gICAgICAgIHRyYW5zID0gMTAwMDAwLjA7XG4gICAgICAgIHNrZXcgPSAwLjA7XG4gICAgICAgIGZvciAoY29uc3Qgc2FtcGxlIG9mIHRoaXMuX3NhbXBsZXMpIHtcbiAgICAgICAgICAgIGlmIChzYW1wbGVbM10gPCB0cmFucykge1xuICAgICAgICAgICAgICAgIHRyYW5zID0gc2FtcGxlWzNdO1xuICAgICAgICAgICAgICAgIHNrZXcgPSBzYW1wbGVbNF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fc2tldyA9IHNrZXc7XG4gICAgICAgIHRoaXMuX3RyYW5zID0gdHJhbnM7XG4gICAgfVxuXG4gICAgZ2V0IHNrZXcoKSB7cmV0dXJuIHRoaXMuX3NrZXc7fVxuICAgIGdldCB0cmFucygpIHtyZXR1cm4gdGhpcy5fdHJhbnM7fVxuXG4gICAgbm93KCkge1xuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2sgaXMgbG9jYWwgY2xvY2sgKyBlc3RpbWF0ZWQgc2tld1xuICAgICAgICByZXR1cm4gQ0xPQ0subm93KCkgKyB0aGlzLl9za2V3O1xuICAgIH1cblxufVxuXG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICBQSU5HRVJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbi8qKlxuICogUGluZ2VyIGludm9rZXMgYSBjYWxsYmFjayByZXBlYXRlZGx5LCBpbmRlZmluaXRlbHkuIFxuICogUGluZ2luZyBpbiAzIHN0YWdlcywgZmlyc3QgZnJlcXVlbnRseSwgdGhlbiBtb2RlcmF0ZWx5LCBcbiAqIHRoZW4gc2xvd2x5LlxuICovXG5cbmNvbnN0IFNNQUxMX0RFTEFZID0gMjA7IC8vIG1zXG5jb25zdCBNRURJVU1fREVMQVkgPSA1MDA7IC8vIG1zXG5jb25zdCBMQVJHRV9ERUxBWSA9IDEwMDAwOyAvLyBtc1xuXG5jb25zdCBERUxBWV9TRVFVRU5DRSA9IFtcbiAgICAuLi5uZXcgQXJyYXkoMykuZmlsbChTTUFMTF9ERUxBWSksIFxuICAgIC4uLm5ldyBBcnJheSg3KS5maWxsKE1FRElVTV9ERUxBWSksXG4gICAgLi4uW0xBUkdFX0RFTEFZXVxuXTtcblxuY2xhc3MgUGluZ2VyIHtcblxuICAgIGNvbnN0cnVjdG9yIChjYWxsYmFjaykge1xuICAgICAgICB0aGlzLl9jb3VudCA9IDA7XG4gICAgICAgIHRoaXMuX3RpZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5fY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgICAgICAgdGhpcy5fcGluZyA9IHRoaXMucGluZy5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9kZWxheXMgPSBbLi4uREVMQVlfU0VRVUVOQ0VdO1xuICAgIH1cbiAgICBwYXVzZSgpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgfVxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgICAgIHRoaXMucGluZygpO1xuICAgIH1cbiAgICByZXN0YXJ0KCkge1xuICAgICAgICB0aGlzLl9kZWxheXMgPSBbLi4uREVMQVlfU0VRVUVOQ0VdO1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHBpbmcgKCkge1xuICAgICAgICBsZXQgbmV4dF9kZWxheSA9IHRoaXMuX2RlbGF5c1swXTtcbiAgICAgICAgaWYgKHRoaXMuX2RlbGF5cy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLl9kZWxheXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5fY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHRoaXMuX2NhbGxiYWNrKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGlkID0gc2V0VGltZW91dCh0aGlzLl9waW5nLCBuZXh0X2RlbGF5KTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgV2ViU29ja2V0SU8gfSBmcm9tIFwiLi93c2lvLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IFByb3h5Q29sbGVjdGlvbiB9IGZyb20gXCIuL3NzX2NvbGxlY3Rpb24uanNcIjtcbmltcG9ydCB7IFByb3h5T2JqZWN0IH0gZnJvbSBcIi4vc3Nfb2JqZWN0LmpzXCI7XG5pbXBvcnQgeyBTZXJ2ZXJDbG9jayB9IGZyb20gXCIuL3NlcnZlcmNsb2NrLmpzXCI7XG5cbmNvbnN0IE1zZ1R5cGUgPSBPYmplY3QuZnJlZXplKHtcbiAgICBNRVNTQUdFIDogXCJNRVNTQUdFXCIsXG4gICAgUkVRVUVTVDogXCJSRVFVRVNUXCIsXG4gICAgUkVQTFk6IFwiUkVQTFlcIlxuIH0pO1xuIFxuY29uc3QgTXNnQ21kID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgR0VUIDogXCJHRVRcIixcbiAgICBQVVQ6IFwiUFVUXCIsXG4gICAgTk9USUZZOiBcIk5PVElGWVwiXG59KTtcblxuXG5leHBvcnQgY2xhc3MgU2hhcmVkU3RhdGVDbGllbnQgZXh0ZW5kcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3RvciAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKHVybCwgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gcmVxdWVzdHNcbiAgICAgICAgdGhpcy5fcmVxaWQgPSAwO1xuICAgICAgICB0aGlzLl9wZW5kaW5nID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgLy8gcGF0aCAtPiB7fSBcbiAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcHJveHkgY29sbGVjdGlvbnMge3BhdGggLT4gcHJveHkgY29sbGVjdGlvbn1cbiAgICAgICAgdGhpcy5fY29sbF9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcHJveHkgb2JqZWN0cyB7W3BhdGgsIGlkXSAtPiBwcm94eSBvYmplY3R9XG4gICAgICAgIHRoaXMuX29ial9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jaztcblxuICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIENPTk5FQ1RJT04gXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHJlZnJlc2ggbG9jYWwgc3VzY3JpcHRpb25zXG4gICAgICAgIGlmICh0aGlzLl9zdWJzX21hcC5zaXplID4gMCkge1xuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3VtZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9uX2Rpc2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucGF1c2UoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbW11bmljYXRpb24gRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgSEFORExFUlNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgbGV0IG1zZyA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLlJFUExZKSB7XG4gICAgICAgICAgICBsZXQgcmVxaWQgPSBtc2cudHVubmVsO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmcuaGFzKHJlcWlkKSkge1xuICAgICAgICAgICAgICAgIGxldCByZXNvbHZlciA9IHRoaXMuX3BlbmRpbmcuZ2V0KHJlcWlkKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nLmRlbGV0ZShyZXFpZCk7XG4gICAgICAgICAgICAgICAgY29uc3Qge29rLCBkYXRhfSA9IG1zZztcbiAgICAgICAgICAgICAgICByZXNvbHZlcih7b2ssIGRhdGF9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLk1FU1NBR0UpIHtcbiAgICAgICAgICAgIGlmIChtc2cuY21kID09IE1zZ0NtZC5OT1RJRlkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVfbm90aWZ5KG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX25vdGlmeShtc2cpIHtcbiAgICAgICAgLy8gdXBkYXRlIHByb3h5IGNvbGxlY3Rpb24gc3RhdGVcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9jb2xsX21hcC5nZXQobXNnW1wicGF0aFwiXSk7XG4gICAgICAgIGlmIChkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRzLl9zc2NsaWVudF91cGRhdGUobXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNFUlZFUiBSRVFVRVNUU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIF9yZXF1ZXN0KGNtZCwgcGF0aCwgYXJnKSB7XG4gICAgICAgIGNvbnN0IHJlcWlkID0gdGhpcy5fcmVxaWQrKztcbiAgICAgICAgY29uc3QgbXNnID0ge1xuICAgICAgICAgICAgdHlwZTogTXNnVHlwZS5SRVFVRVNULFxuICAgICAgICAgICAgY21kLCBcbiAgICAgICAgICAgIHBhdGgsIFxuICAgICAgICAgICAgYXJnLFxuICAgICAgICAgICAgdHVubmVsOiByZXFpZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlbmQoSlNPTi5zdHJpbmdpZnkobXNnKSk7XG4gICAgICAgIGxldCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgdGhpcy5fcGVuZGluZy5zZXQocmVxaWQsIHJlc29sdmVyKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgLy8gc3BlY2lhbCBoYW5kbGluZyBmb3IgcmVwbGllcyB0byBQVVQgL3N1YnNcbiAgICAgICAgICAgIGlmIChjbWQgPT0gTXNnQ21kLlBVVCAmJiBwYXRoID09IFwiL3N1YnNcIiAmJiBvaykge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzY3JpcHRpb24gc3RhdGVcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoZGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7b2ssIHBhdGgsIGRhdGF9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfc3ViIChwYXRoKSB7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgICAgIC8vIHNldCBuZXcgcGF0aFxuICAgICAgICAgICAgc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnMgLSBzdWJzY3JpYmUgb24gcmVjb25uZWN0XG4gICAgICAgICAgICB0aGlzLl9zdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7b2s6IHRydWUsIHBhdGgsIGRhdGE6dW5kZWZpbmVkfSlcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgX3Vuc3ViIChwYXRoKSB7XG4gICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgLy8gcmVtb3ZlIHBhdGhcbiAgICAgICAgc3Vic19tYXAuZGVsZXRlKHBhdGgpXG4gICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnN1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8vIGFjY3Nlc3NvciBmb3Igc2VydmVyIGNsb2NrXG4gICAgZ2V0IGNsb2NrKCkge1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrID0gbmV3IFNlcnZlckNsb2NrKHRoaXMpO1xuICAgICAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnJlc3VtZSgpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9zZXJ2ZXJfY2xvY2s7XG4gICAgfVxuXG4gICAgLy8gZ2V0IHJlcXVlc3QgZm9yIGl0ZW1zIGJ5IHBhdGhcbiAgICBnZXQocGF0aCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuR0VULCBwYXRoKTtcbiAgICB9XG4gICAgXG4gICAgLy8gdXBkYXRlIHJlcXVlc3QgZm9yIHBhdGhcbiAgICB1cGRhdGUocGF0aCwgY2hhbmdlcykge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuUFVULCBwYXRoLCBjaGFuZ2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIHByb3h5IGNvbGxlY3Rpb24gZm9yIHBhdGhcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlcyB0byBwYXRoIGlmIG5lZWRlZFxuICAgICAqL1xuICAgIGFjcXVpcmVfY29sbGVjdGlvbiAocGF0aCwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBzdWJzY3JpcHRpb24gZG9lcyBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBjb2xsZWN0aW9uIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9jb2xsX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2NvbGxfbWFwLnNldChwYXRoLCBuZXcgUHJveHlDb2xsZWN0aW9uKHRoaXMsIHBhdGgsIG9wdGlvbnMpKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fY29sbF9tYXAuZ2V0KHBhdGgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFjcXVpcmUgb2JqZWN0IGZvciAocGF0aCwgbmFtZSlcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgYWNxdWlyZSBwcm94eSBjb2xsZWN0aW9uXG4gICAgICovXG4gICAgYWNxdWlyZV9vYmplY3QgKHBhdGgsIG5hbWUsIG9wdGlvbnMpIHtcbiAgICAgICAgcGF0aCA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoIDogXCIvXCIgKyBwYXRoO1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuYWNxdWlyZV9jb2xsZWN0aW9uKHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgcHJveHkgb2JqZWN0IGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9vYmpfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fb2JqX21hcC5zZXQocGF0aCwgbmV3IE1hcCgpKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBvYmpfbWFwID0gdGhpcy5fb2JqX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmICghb2JqX21hcC5nZXQobmFtZSkpIHtcbiAgICAgICAgICAgIG9ial9tYXAuc2V0KG5hbWUsIG5ldyBQcm94eU9iamVjdChkcywgbmFtZSwgb3B0aW9ucykpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9ial9tYXAuZ2V0KG5hbWUpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogcmVsZWFzZSBwYXRoLCBpbmNsdWRpbmcgcHJveHkgY29sbGVjdGlvbiBhbmQgcHJveHkgb2JqZWN0c1xuICAgICAqL1xuICAgIHJlbGVhc2UocGF0aCkge1xuICAgICAgICAvLyB1bnN1YnNjcmliZVxuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl91bnN1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyB0ZXJtaW5hdGUgcHJveHkgY29sbGVjdGlvbiBhbmQgcHJveHkgb2JqZWN0c1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICAgICAgZHMuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICBjb25zdCBvYmpfbWFwID0gdGhpcy5fb2JqX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmIChvYmpfbWFwICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCB2IG9mIG9ial9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgICAgICB2Ll9zc2NsaWVudF90ZXJtaW5hdGUoKTtcbiAgICAgICAgICAgIH0gICAgXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29sbF9tYXAuZGVsZXRlKHBhdGgpO1xuICAgICAgICB0aGlzLl9vYmpfbWFwLmRlbGV0ZShwYXRoKTtcbiAgICB9XG59XG5cblxuIiwiLypcbiAgICBDb2xsZWN0aW9uIFZpZXdlclxuKi9cblxuZnVuY3Rpb24gaXRlbTJzdHJpbmcoaXRlbSkge1xuICAgIGNvbnN0IHtpZCwgaXR2LCBkYXRhfSA9IGl0ZW07XG4gICAgbGV0IGRhdGFfdHh0ID0gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgbGV0IGl0dl90eHQgPSAoaXR2ICE9IHVuZGVmaW5lZCkgPyBKU09OLnN0cmluZ2lmeShpdHYpIDogXCJcIjtcbiAgICBsZXQgaWRfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImlkXCI+JHtpZH08L3NwYW4+YDtcbiAgICBsZXQgaXR2X2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpdHZcIj4ke2l0dl90eHR9PC9zcGFuPmA7XG4gICAgbGV0IGRhdGFfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImRhdGFcIj4ke2RhdGFfdHh0fTwvc3Bhbj5gO1xuICAgIHJldHVybiBgXG4gICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8YnV0dG9uIGlkPVwiZGVsZXRlXCI+WDwvYnV0dG9uPlxuICAgICAgICAgICAgJHtpZF9odG1sfTogJHtpdHZfaHRtbH0gJHtkYXRhX2h0bWx9XG4gICAgICAgIDwvZGl2PmA7XG59XG5cblxuZXhwb3J0IGNsYXNzIENvbGxlY3Rpb25WaWV3ZXIge1xuXG4gICAgY29uc3RydWN0b3IoY29sbGVjdGlvbiwgZWxlbSwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl9jb2xsID0gY29sbGVjdGlvbjtcbiAgICAgICAgdGhpcy5fZWxlbSA9IGVsZW07XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpOyBcblxuICAgICAgICAvLyBvcHRpb25zXG4gICAgICAgIGxldCBkZWZhdWx0cyA9IHtcbiAgICAgICAgICAgIGRlbGV0ZTpmYWxzZSxcbiAgICAgICAgICAgIHRvU3RyaW5nOml0ZW0yc3RyaW5nXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSB7Li4uZGVmYXVsdHMsIC4uLm9wdGlvbnN9O1xuXG4gICAgICAgIC8qXG4gICAgICAgICAgICBTdXBwb3J0IGRlbGV0ZVxuICAgICAgICAqL1xuICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5kZWxldGUpIHtcbiAgICAgICAgICAgIC8vIGxpc3RlbiBmb3IgY2xpY2sgZXZlbnRzIG9uIHJvb3QgZWxlbWVudFxuICAgICAgICAgICAgZWxlbS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYXRjaCBjbGljayBldmVudCBmcm9tIGRlbGV0ZSBidXR0b25cbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVCdG4gPSBlLnRhcmdldC5jbG9zZXN0KFwiI2RlbGV0ZVwiKTtcbiAgICAgICAgICAgICAgICBpZiAoZGVsZXRlQnRuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpc3RJdGVtID0gZGVsZXRlQnRuLmNsb3Nlc3QoXCIubGlzdC1pdGVtXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobGlzdEl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2NvbGwudXBkYXRlKHtyZW1vdmU6W2xpc3RJdGVtLmlkXX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIHJlbmRlciBpbml0aWFsIHN0YXRlXG4gICAgICAgICovIFxuICAgICAgICBjb25zdCBkaWZmcyA9IHRoaXMuX2NvbGwuZ2V0KClcbiAgICAgICAgICAgIC5tYXAoaXRlbSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtpZDppdGVtLmlkLCBuZXc6aXRlbX1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB0aGlzLl9vbmNoYW5nZShkaWZmcyk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGNvbnN0IHt0b1N0cmluZ30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBmb3IgKGxldCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5uZXcpIHtcbiAgICAgICAgICAgICAgICAvLyBhZGRcbiAgICAgICAgICAgICAgICBsZXQgbm9kZSA9IHRoaXMuX2VsZW0ucXVlcnlTZWxlY3RvcihgIyR7ZGlmZi5pZH1gKTtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZShcImlkXCIsIGRpZmYuaWQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNsYXNzTGlzdC5hZGQoXCJsaXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VsZW0uYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5vZGUuaW5uZXJIVE1MID0gdG9TdHJpbmcoZGlmZi5uZXcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkaWZmLm9sZCkge1xuICAgICAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0lBQUE7SUFDQTtJQUNBO0lBQ0E7SUFDQTs7SUFFTyxTQUFTLGlCQUFpQixHQUFHO0lBQ3BDLElBQUksSUFBSSxRQUFRO0lBQ2hCLElBQUksSUFBSSxPQUFPLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxLQUFLO0lBQ25ELFFBQVEsUUFBUSxHQUFHLE9BQU87SUFDMUIsS0FBSyxDQUFDO0lBQ04sSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQztJQUM5Qjs7O0lBbUJPLFNBQVMsYUFBYSxDQUFDLE1BQU0sRUFBRTtJQUN0QyxJQUFJLElBQUksSUFBSSxHQUFHLEVBQUU7SUFDakIsSUFBSSxJQUFJLFFBQVEsR0FBRyxzREFBc0Q7SUFDekUsSUFBSSxJQUFJLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO0lBQ3BDLFFBQVEsSUFBSSxJQUFJLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEdBQUcsUUFBUSxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQzVFO0lBQ0EsSUFBSSxPQUFPLElBQUk7SUFDZjs7SUNwQ0EsTUFBTSxXQUFXLEdBQUcsQ0FBQzs7SUFFZCxNQUFNLFdBQVcsQ0FBQzs7SUFFekIsSUFBSSxXQUFXLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQyxFQUFFLEVBQUU7SUFDakMsUUFBUSxJQUFJLENBQUMsSUFBSSxHQUFHLEdBQUc7SUFDdkIsUUFBUSxJQUFJLENBQUMsR0FBRztJQUNoQixRQUFRLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSztJQUNoQyxRQUFRLElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSztJQUMvQixRQUFRLElBQUks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
