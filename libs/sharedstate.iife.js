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
        has_item(id) {return this._map.has(id)}
        get_item(id) {return this._map.get(id)}
        get_items() {return [...this._map.values()]}

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
            if (this._coll.has_item(this._id)) {
                return this._coll.get_item(this._id).data;
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
            const diffs = this._coll.get_items()
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vY2xpZW50L3V0aWwuanMiLCIuLi8uLi9jbGllbnQvd3Npby5qcyIsIi4uLy4uL2NsaWVudC9zc19jb2xsZWN0aW9uLmpzIiwiLi4vLi4vY2xpZW50L3NzX29iamVjdC5qcyIsIi4uLy4uL2NsaWVudC9zZXJ2ZXJjbG9jay5qcyIsIi4uLy4uL2NsaWVudC9zc19jbGllbnQuanMiLCIuLi8uLi9jbGllbnQvdmlld2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gICAgQ3JlYXRlIGEgcHJvbWlzZSB3aGljaCBjYW4gYmUgcmVzb2x2ZWRcbiAgICBwcm9ncmFtbWF0aWNhbGx5IGJ5IGV4dGVybmFsIGNvZGUuXG4gICAgUmV0dXJuIGEgcHJvbWlzZSBhbmQgYSByZXNvbHZlIGZ1bmN0aW9uXG4qL1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2YWJsZVByb21pc2UoKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICByZXNvbHZlciA9IHJlc29sdmU7XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0UHJvbWlzZSAobXMpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGxldCB0aWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgIH0sIG1zKTtcbiAgICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGlkKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByYW5kb21fc3RyaW5nKGxlbmd0aCkge1xuICAgIHZhciB0ZXh0ID0gXCJcIjtcbiAgICB2YXIgcG9zc2libGUgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpcIjtcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGV4dCArPSBwb3NzaWJsZS5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9zc2libGUubGVuZ3RoKSk7XG4gICAgfVxuICAgIHJldHVybiB0ZXh0O1xufSIsImltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuXG5jb25zdCBNQVhfUkVUUklFUyA9IDQ7XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdXJsID0gdXJsO1xuICAgICAgICB0aGlzLl93cztcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgfVxuXG4gICAgZ2V0IGNvbm5lY3RpbmcoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3Rpbmc7fVxuICAgIGdldCBjb25uZWN0ZWQoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3RlZDt9XG4gICAgZ2V0IHVybCgpIHtyZXR1cm4gdGhpcy5fdXJsO31cbiAgICBnZXQgb3B0aW9ucygpIHtyZXR1cm4gdGhpcy5fb3B0aW9uczt9XG5cbiAgICBjb25uZWN0KCkge1xuXG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RpbmcgfHwgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ29ubmVjdCB3aGlsZSBjb25uZWN0aW5nIG9yIGNvbm5lY3RlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIlRlcm1pbmF0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25uZWN0aW5nXG4gICAgICAgIHRoaXMuX3dzID0gbmV3IFdlYlNvY2tldCh0aGlzLl91cmwpO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gZSA9PiB0aGlzLl9vbl9vcGVuKGUpO1xuICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSBlID0+IHRoaXMub25fbWVzc2FnZShlLmRhdGEpO1xuICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gZSA9PiB0aGlzLl9vbl9jbG9zZShlKTtcbiAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IGUgPT4gdGhpcy5vbl9lcnJvcihlKTtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0aW5nKCk7XG4gICAgfVxuXG4gICAgX29uX29wZW4oZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAvLyByZWxlYXNlIGNvbm5lY3QgcHJvbWlzZXNcbiAgICAgICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICAgICAgLy8gcmVzZXQgcmV0cmllcyBvbiBzdWNjZXNzZnVsIGNvbm5lY3Rpb25cbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMub25fY29ubmVjdCgpO1xuICAgIH1cblxuICAgIF9vbl9jbG9zZShldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLm9uX2Rpc2Nvbm5lY3QoZXZlbnQpO1xuICAgICAgICB0aGlzLl9yZXRyaWVzICs9IDE7XG4gICAgICAgIGlmICghdGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICAgICAgICAgIH0sIDEwMDAgKiB0aGlzLl9yZXRyaWVzKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBfaXNfdGVybWluYXRlZCgpIHtcbiAgICAgICAgY29uc3Qge3JldHJpZXM9TUFYX1JFVFJJRVN9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKHRoaXMuX3JldHJpZXMgPj0gcmV0cmllcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFRlcm1pbmF0ZWQ6IE1heCByZXRyaWVzIHJlYWNoZWQgKCR7cmV0cmllc30pYCk7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cyA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBvbl9jb25uZWN0aW5nKCkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbm5lY3RpbmcgJHt0aGlzLnVybH1gKTt9XG4gICAgfVxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdChldmVudCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYFJlY2VpdmU6ICR7ZGF0YX1gKTt9XG4gICAgfVxuXG4gICAgc2VuZChkYXRhKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fd3Muc2VuZChkYXRhKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU2VuZCBmYWlsOiAke2Vycm9yfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbmQgZHJvcCA6IG5vdCBjb25uZWN0ZWRgKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29ubmVjdGVkUHJvbWlzZSgpIHtcbiAgICAgICAgY29uc3QgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMucHVzaChyZXNvbHZlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IHJhbmRvbV9zdHJpbmcgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm94eUNvbGxlY3Rpb24ge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxlYXNlZCBieSBzcyBjbGllbnRcbiAgICAgKi9cblxuICAgIF9zc2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAvLyBlbXB0eSBjb2xsZWN0aW9uP1xuICAgICAgICAvLyBkaXNjb25uZWN0IGZyb20gb2JzZXJ2ZXJzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBjb2xsZWN0aW9uIFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHtyZW1vdmUsIGluc2VydCwgcmVzZXQ9ZmFsc2V9ID0gY2hhbmdlcztcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlIGl0ZW1zIC0gY3JlYXRlIGRpZmZcbiAgICAgICAgaWYgKHJlc2V0KSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdGhpcy5fbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KFxuICAgICAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICAgICAge2lkOiBpdGVtLmlkLCBuZXc6dW5kZWZpbmVkLCBvbGQ6aXRlbX1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBfaWQgb2YgcmVtb3ZlKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb2xkID0gdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcC5kZWxldGUoX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3OnVuZGVmaW5lZCwgb2xkfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0IGl0ZW1zIC0gdXBkYXRlIGRpZmZcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGluc2VydCkge1xuICAgICAgICAgICAgY29uc3QgX2lkID0gaXRlbS5pZDtcbiAgICAgICAgICAgIC8vIG9sZCBmcm9tIGRpZmZfbWFwIG9yIF9tYXBcbiAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBkaWZmX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IChkaWZmICE9IHVuZGVmaW5lZCkgPyBkaWZmLm9sZCA6IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIC8vIHNldCBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5fbWFwLnNldChfaWQsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gdXBkYXRlIGRpZmYgbWFwXG4gICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6aXRlbSwgb2xkfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5X2NhbGxiYWNrcyhbLi4uZGlmZl9tYXAudmFsdWVzKCldKTtcbiAgICB9XG5cbiAgICBfbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQUExJQ0FUSU9OIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9XG4gICAgaGFzX2l0ZW0oaWQpIHtyZXR1cm4gdGhpcy5fbWFwLmhhcyhpZCl9XG4gICAgZ2V0X2l0ZW0oaWQpIHtyZXR1cm4gdGhpcy5fbWFwLmdldChpZCl9XG4gICAgZ2V0X2l0ZW1zKCkge3JldHVybiBbLi4udGhpcy5fbWFwLnZhbHVlcygpXX1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIGRpc3BhdGNoaW5nIHVwZGF0ZSB0byBzZXJ2ZXJcbiAgICAgKi9cbiAgICB1cGRhdGUgKGNoYW5nZXM9e30pIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbGxlY3Rpb24gYWxyZWFkeSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgLy8gZW5zdXJlIHRoYXQgaW5zZXJ0ZWQgaXRlbXMgaGF2ZSBpZHNcbiAgICAgICAgY29uc3Qge2luc2VydD1bXX0gPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzLmluc2VydCA9IGluc2VydC5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW0uaWQgPSBpdGVtLmlkIHx8IHJhbmRvbV9zdHJpbmcoMTApO1xuICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGhpcy5fc3NjbGllbnQudXBkYXRlKHRoaXMuX3BhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIHJlZ2lzdGVyIGNhbGxiYWNrXG4gICAgKi9cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTsgICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTsgICAgXG59IiwiXG4vKipcbiAqIFByb3h5IE9iamVjdFxuICogXG4gKiBDbGllbnQtc2lkZSBwcm94eSBvYmplY3QgZm9yIGEgc2VydmVyLXNpZGUgb2JqZWN0LlxuICpcbiAqIEltcGxlbWVudGF0aW9uIGxldmVyYWdlcyBQcm94eUNvbGxlY3Rpb24uIEFzIHN1Y2gsIHRoZSB2YWx1ZSBvZiB0aGUgcHJveHkgb2JqZWN0XG4gKiBjb3JyZXNwb25kcyB0byB0aGUgZGF0YSBwcm9wZXJ0eSBvZiBhIHNpbmdsZSBpdGVtIHdpdGggKmlkKiB3aXRoaW4gYSBcbiAqIHNwZWNpZmljIHNlcnZlci1zaWRlIGNvbGxlY3Rpb24uIElmIG5vIGl0ZW0gd2l0aCAqaWQqIGV4aXN0cyBpbiB0aGUgY29sbGVjdGlvbiwgdGhlXG4gKiB2YWx1ZSBvZiB0aGUgcHJveHkgb2JqZWN0IGlzIHVuZGVmaW5lZC4gXG4gKiBcbiAqIHNldCgpIGFuZCBnZXQoKSBtZXRob2RzIGFyZSB1c2VkIHRvIHNldCBhbmQgZ2V0IHRoZSB2YWx1ZSBvZiB0aGUgcHJveHkgb2JqZWN0LlxuICogXG4gKi9cblxuZXhwb3J0IGNsYXNzIFByb3h5T2JqZWN0IHtcblxuICAgIGNvbnN0cnVjdG9yKHByb3h5Q29sbGVjdGlvbiwgaWQsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdGVybWluaWF0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29sbCA9IHByb3h5Q29sbGVjdGlvbjtcbiAgICAgICAgdGhpcy5faWQgPSBpZDtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIC8vIGNhbGxiYWNrXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIF9vbmNoYW5nZShkaWZmcykge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicHJveHkgb2JqZWN0IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLmlkID09IHRoaXMuX2lkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5ub3RpZnlfY2FsbGJhY2tzKGRpZmYpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkX2NhbGxiYWNrIChoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtoYW5kbGVyOiBoYW5kbGVyfTtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMucHVzaChoYW5kbGUpO1xuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG4gICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5faGFuZGxlcnMuaW5kZXhPZihoYW5kbGUpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5faGFuZGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTtcbiAgICBcbiAgICBub3RpZnlfY2FsbGJhY2tzIChlQXJnKSB7XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLmZvckVhY2goZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgICAgICBoYW5kbGUuaGFuZGxlcihlQXJnKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIFxuICAgIHNldCAob2JqKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwcm94eSBvYmplY3QgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGl0ZW1zID0gW3tpZDp0aGlzLl9pZCwgZGF0YTpvYmp9XTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGwudXBkYXRlKHtpbnNlcnQ6aXRlbXMsIHJlc2V0OmZhbHNlfSk7XG4gICAgfVxuXG4gICAgZ2V0ICgpIHtcbiAgICAgICAgaWYgKHRoaXMuX2NvbGwuaGFzX2l0ZW0odGhpcy5faWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY29sbC5nZXRfaXRlbSh0aGlzLl9pZCkuZGF0YTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICAgIH1cbiAgICB9XG4gICAgXG4gICAgc3NfY2xpZW50X3Rlcm1pbmF0ZSgpIHtcbiAgICAgICAgdGhpcy5fdGVybWluYXRlZCA9IHRydWU7XG4gICAgICAgIHRoaXMuX2NvbGwucmVtb3ZlX2NhbGxiYWNrKHRoaXMuX2hhbmRsZSk7XG4gICAgfVxufSIsIi8vIHdlYnBhZ2UgY2xvY2sgLSBwZXJmb3JtYW5jZSBub3cgLSBzZWNvbmRzXG5jb25zdCBsb2NhbCA9IHtcbiAgICBub3c6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gcGVyZm9ybWFuY2Uubm93KCkvMTAwMC4wO1xuICAgIH1cbn1cbi8vIHN5c3RlbSBjbG9jayAtIGVwb2NoIC0gc2Vjb25kc1xuY29uc3QgZXBvY2ggPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIG5ldyBEYXRlKCkvMTAwMC4wO1xuICAgIH1cbn1cblxuLyoqXG4gKiBDTE9DSyBnaXZlcyBlcG9jaCB2YWx1ZXMsIGJ1dCBpcyBpbXBsZW1lbnRlZFxuICogdXNpbmcgcGVyZm9ybWFuY2Ugbm93IGZvciBiZXR0ZXJcbiAqIHRpbWUgcmVzb2x1dGlvbiBhbmQgcHJvdGVjdGlvbiBhZ2FpbnN0IHN5c3RlbSBcbiAqIHRpbWUgYWRqdXN0bWVudHMuXG4gKi9cblxuY29uc3QgQ0xPQ0sgPSBmdW5jdGlvbiAoKSB7XG4gICAgY29uc3QgdDBfbG9jYWwgPSBsb2NhbC5ub3coKTtcbiAgICBjb25zdCB0MF9lcG9jaCA9IGVwb2NoLm5vdygpO1xuICAgIHJldHVybiB7XG4gICAgICAgIG5vdzogZnVuY3Rpb24gKCkge1xuICAgICAgICAgICAgY29uc3QgdDFfbG9jYWwgPSBsb2NhbC5ub3coKTtcbiAgICAgICAgICAgIHJldHVybiB0MF9lcG9jaCArICh0MV9sb2NhbCAtIHQwX2xvY2FsKTtcbiAgICAgICAgfVxuICAgIH07XG59KCk7XG5cblxuLyoqXG4gKiBFc3RpbWF0ZSB0aGUgY2xvY2sgb2YgdGhlIHNlcnZlciBcbiAqL1xuXG5jb25zdCBNQVhfU0FNUExFX0NPVU5UID0gMzA7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXJDbG9jayB7XG5cbiAgICBjb25zdHJ1Y3Rvcihzc2NsaWVudCkge1xuICAgICAgICAvLyBzaGFyZXN0YXRlIGNsaWVudFxuICAgICAgICB0aGlzLl9zc2NsaWVudCA9IHNzY2xpZW50O1xuICAgICAgICAvLyBwaW5nZXJcbiAgICAgICAgdGhpcy5fcGluZ2VyID0gbmV3IFBpbmdlcih0aGlzLl9vbnBpbmcuYmluZCh0aGlzKSk7XG4gICAgICAgIC8vIHNhbXBsZXNcbiAgICAgICAgdGhpcy5fc2FtcGxlcyA9IFtdO1xuICAgICAgICAvLyBlc3RpbWF0ZXNcbiAgICAgICAgdGhpcy5fdHJhbnMgPSAxMDAwLjA7XG4gICAgICAgIHRoaXMuX3NrZXcgPSAwLjA7XG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICB0aGlzLl9waW5nZXIucmVzdW1lKCk7XG4gICAgfVxuXG4gICAgcGF1c2UoKSB7XG4gICAgICAgIHRoaXMuX3Bpbmdlci5wYXVzZSgpO1xuICAgIH1cblxuICAgIF9vbnBpbmcoKSB7XG4gICAgICAgIGNvbnN0IHRzMCA9IENMT0NLLm5vdygpO1xuICAgICAgICB0aGlzLl9zc2NsaWVudC5nZXQoXCIvY2xvY2tcIikudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgaWYgKG9rKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgdHMxID0gQ0xPQ0subm93KCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fYWRkX3NhbXBsZSh0czAsIGRhdGEsIHRzMSk7ICAgIFxuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfYWRkX3NhbXBsZShjcywgc3MsIGNyKSB7XG4gICAgICAgIGxldCB0cmFucyA9IChjciAtIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNrZXcgPSBzcyAtIChjciArIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNhbXBsZSA9IFtjcywgc3MsIGNyLCB0cmFucywgc2tld107XG4gICAgICAgIC8vIGFkZCB0byBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMucHVzaChzYW1wbGUpXG4gICAgICAgIGlmICh0aGlzLl9zYW1wbGVzLmxlbmd0aCA+IE1BWF9TQU1QTEVfQ09VTlQpIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZSBmaXJzdCBzYW1wbGVcbiAgICAgICAgICAgIHRoaXMuX3NhbXBsZXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZWV2YWx1YXRlIGVzdGltYXRlcyBmb3Igc2tldyBhbmQgdHJhbnNcbiAgICAgICAgdHJhbnMgPSAxMDAwMDAuMDtcbiAgICAgICAgc2tldyA9IDAuMDtcbiAgICAgICAgZm9yIChjb25zdCBzYW1wbGUgb2YgdGhpcy5fc2FtcGxlcykge1xuICAgICAgICAgICAgaWYgKHNhbXBsZVszXSA8IHRyYW5zKSB7XG4gICAgICAgICAgICAgICAgdHJhbnMgPSBzYW1wbGVbM107XG4gICAgICAgICAgICAgICAgc2tldyA9IHNhbXBsZVs0XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9za2V3ID0gc2tldztcbiAgICAgICAgdGhpcy5fdHJhbnMgPSB0cmFucztcbiAgICB9XG5cbiAgICBnZXQgc2tldygpIHtyZXR1cm4gdGhpcy5fc2tldzt9XG4gICAgZ2V0IHRyYW5zKCkge3JldHVybiB0aGlzLl90cmFuczt9XG5cbiAgICBub3coKSB7XG4gICAgICAgIC8vIHNlcnZlciBjbG9jayBpcyBsb2NhbCBjbG9jayArIGVzdGltYXRlZCBza2V3XG4gICAgICAgIHJldHVybiBDTE9DSy5ub3coKSArIHRoaXMuX3NrZXc7XG4gICAgfVxuXG59XG5cblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgIFBJTkdFUlxuKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuLyoqXG4gKiBQaW5nZXIgaW52b2tlcyBhIGNhbGxiYWNrIHJlcGVhdGVkbHksIGluZGVmaW5pdGVseS4gXG4gKiBQaW5naW5nIGluIDMgc3RhZ2VzLCBmaXJzdCBmcmVxdWVudGx5LCB0aGVuIG1vZGVyYXRlbHksIFxuICogdGhlbiBzbG93bHkuXG4gKi9cblxuY29uc3QgU01BTExfREVMQVkgPSAyMDsgLy8gbXNcbmNvbnN0IE1FRElVTV9ERUxBWSA9IDUwMDsgLy8gbXNcbmNvbnN0IExBUkdFX0RFTEFZID0gMTAwMDA7IC8vIG1zXG5cbmNvbnN0IERFTEFZX1NFUVVFTkNFID0gW1xuICAgIC4uLm5ldyBBcnJheSgzKS5maWxsKFNNQUxMX0RFTEFZKSwgXG4gICAgLi4ubmV3IEFycmF5KDcpLmZpbGwoTUVESVVNX0RFTEFZKSxcbiAgICAuLi5bTEFSR0VfREVMQVldXG5dO1xuXG5jbGFzcyBQaW5nZXIge1xuXG4gICAgY29uc3RydWN0b3IgKGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuX2NvdW50ID0gMDtcbiAgICAgICAgdGhpcy5fdGlkID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICAgICAgICB0aGlzLl9waW5nID0gdGhpcy5waW5nLmJpbmQodGhpcyk7XG4gICAgICAgIHRoaXMuX2RlbGF5cyA9IFsuLi5ERUxBWV9TRVFVRU5DRV07XG4gICAgfVxuICAgIHBhdXNlKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICB9XG4gICAgcmVzdW1lKCkge1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHJlc3RhcnQoKSB7XG4gICAgICAgIHRoaXMuX2RlbGF5cyA9IFsuLi5ERUxBWV9TRVFVRU5DRV07XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgICAgICB0aGlzLnBpbmcoKTtcbiAgICB9XG4gICAgcGluZyAoKSB7XG4gICAgICAgIGxldCBuZXh0X2RlbGF5ID0gdGhpcy5fZGVsYXlzWzBdO1xuICAgICAgICBpZiAodGhpcy5fZGVsYXlzLmxlbmd0aCA+IDEpIHtcbiAgICAgICAgICAgIHRoaXMuX2RlbGF5cy5zaGlmdCgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9jYWxsYmFjaykge1xuICAgICAgICAgICAgdGhpcy5fY2FsbGJhY2soKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl90aWQgPSBzZXRUaW1lb3V0KHRoaXMuX3BpbmcsIG5leHRfZGVsYXkpO1xuICAgIH1cbn1cblxuXG4iLCJpbXBvcnQgeyBXZWJTb2NrZXRJTyB9IGZyb20gXCIuL3dzaW8uanNcIjtcbmltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuaW1wb3J0IHsgUHJveHlDb2xsZWN0aW9uIH0gZnJvbSBcIi4vc3NfY29sbGVjdGlvbi5qc1wiO1xuaW1wb3J0IHsgUHJveHlPYmplY3QgfSBmcm9tIFwiLi9zc19vYmplY3QuanNcIjtcbmltcG9ydCB7IFNlcnZlckNsb2NrIH0gZnJvbSBcIi4vc2VydmVyY2xvY2suanNcIjtcblxuY29uc3QgTXNnVHlwZSA9IE9iamVjdC5mcmVlemUoe1xuICAgIE1FU1NBR0UgOiBcIk1FU1NBR0VcIixcbiAgICBSRVFVRVNUOiBcIlJFUVVFU1RcIixcbiAgICBSRVBMWTogXCJSRVBMWVwiXG4gfSk7XG4gXG5jb25zdCBNc2dDbWQgPSBPYmplY3QuZnJlZXplKHtcbiAgICBHRVQgOiBcIkdFVFwiLFxuICAgIFBVVDogXCJQVVRcIixcbiAgICBOT1RJRlk6IFwiTk9USUZZXCJcbn0pO1xuXG5cbmV4cG9ydCBjbGFzcyBTaGFyZWRTdGF0ZUNsaWVudCBleHRlbmRzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yICh1cmwsIG9wdGlvbnMpIHtcbiAgICAgICAgc3VwZXIodXJsLCBvcHRpb25zKTtcblxuICAgICAgICAvLyByZXF1ZXN0c1xuICAgICAgICB0aGlzLl9yZXFpZCA9IDA7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gc3Vic2NyaXB0aW9uc1xuICAgICAgICAvLyBwYXRoIC0+IHt9IFxuICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBwcm94eSBjb2xsZWN0aW9ucyB7cGF0aCAtPiBwcm94eSBjb2xsZWN0aW9ufVxuICAgICAgICB0aGlzLl9jb2xsX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBwcm94eSBvYmplY3RzIHtbcGF0aCwgaWRdIC0+IHByb3h5IG9iamVjdH1cbiAgICAgICAgdGhpcy5fb2JqX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2tcbiAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrO1xuXG4gICAgICAgIHRoaXMuY29ubmVjdCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQ09OTkVDVElPTiBcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gcmVmcmVzaCBsb2NhbCBzdXNjcmlwdGlvbnNcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucmVzdW1lKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2tcbiAgICAgICAgaWYgKHRoaXMuX3NlcnZlcl9jbG9jayAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jay5wYXVzZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29tbXVuaWNhdGlvbiBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBIQU5ETEVSU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBsZXQgbXNnID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuUkVQTFkpIHtcbiAgICAgICAgICAgIGxldCByZXFpZCA9IG1zZy50dW5uZWw7XG4gICAgICAgICAgICBpZiAodGhpcy5fcGVuZGluZy5oYXMocmVxaWQpKSB7XG4gICAgICAgICAgICAgICAgbGV0IHJlc29sdmVyID0gdGhpcy5fcGVuZGluZy5nZXQocmVxaWQpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3BlbmRpbmcuZGVsZXRlKHJlcWlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCB7b2ssIGRhdGF9ID0gbXNnO1xuICAgICAgICAgICAgICAgIHJlc29sdmVyKHtvaywgZGF0YX0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuTUVTU0FHRSkge1xuICAgICAgICAgICAgaWYgKG1zZy5jbWQgPT0gTXNnQ21kLk5PVElGWSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2hhbmRsZV9ub3RpZnkobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9oYW5kbGVfbm90aWZ5KG1zZykge1xuICAgICAgICAvLyB1cGRhdGUgcHJveHkgY29sbGVjdGlvbiBzdGF0ZVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChtc2dbXCJwYXRoXCJdKTtcbiAgICAgICAgaWYgKGRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZHMuX3NzY2xpZW50X3VwZGF0ZShtc2dbXCJkYXRhXCJdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0VSVkVSIFJFUVVFU1RTXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgX3JlcXVlc3QoY21kLCBwYXRoLCBhcmcpIHtcbiAgICAgICAgY29uc3QgcmVxaWQgPSB0aGlzLl9yZXFpZCsrO1xuICAgICAgICBjb25zdCBtc2cgPSB7XG4gICAgICAgICAgICB0eXBlOiBNc2dUeXBlLlJFUVVFU1QsXG4gICAgICAgICAgICBjbWQsIFxuICAgICAgICAgICAgcGF0aCwgXG4gICAgICAgICAgICBhcmcsXG4gICAgICAgICAgICB0dW5uZWw6IHJlcWlkXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuc2VuZChKU09OLnN0cmluZ2lmeShtc2cpKTtcbiAgICAgICAgbGV0IFtwcm9taXNlLCByZXNvbHZlcl0gPSByZXNvbHZhYmxlUHJvbWlzZSgpO1xuICAgICAgICB0aGlzLl9wZW5kaW5nLnNldChyZXFpZCwgcmVzb2x2ZXIpO1xuICAgICAgICByZXR1cm4gcHJvbWlzZS50aGVuKCh7b2ssIGRhdGF9KSA9PiB7XG4gICAgICAgICAgICAvLyBzcGVjaWFsIGhhbmRsaW5nIGZvciByZXBsaWVzIHRvIFBVVCAvc3Vic1xuICAgICAgICAgICAgaWYgKGNtZCA9PSBNc2dDbWQuUFVUICYmIHBhdGggPT0gXCIvc3Vic1wiICYmIG9rKSB7XG4gICAgICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnNjcmlwdGlvbiBzdGF0ZVxuICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcChkYXRhKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtvaywgcGF0aCwgZGF0YX07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9zdWIgKHBhdGgpIHtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAgICAgLy8gc2V0IG5ldyBwYXRoXG4gICAgICAgICAgICBzdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnRoaXMuX3N1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3VicyAtIHN1YnNjcmliZSBvbiByZWNvbm5lY3RcbiAgICAgICAgICAgIHRoaXMuX3N1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtvazogdHJ1ZSwgcGF0aCwgZGF0YTp1bmRlZmluZWR9KVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBfdW5zdWIgKHBhdGgpIHtcbiAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAvLyByZW1vdmUgcGF0aFxuICAgICAgICBzdWJzX21hcC5kZWxldGUocGF0aClcbiAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4uc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLy8gYWNjc2Vzc29yIGZvciBzZXJ2ZXIgY2xvY2tcbiAgICBnZXQgY2xvY2soKSB7XG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sgPSBuZXcgU2VydmVyQ2xvY2sodGhpcyk7XG4gICAgICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucmVzdW1lKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3NlcnZlcl9jbG9jaztcbiAgICB9XG5cbiAgICAvLyBnZXQgcmVxdWVzdCBmb3IgaXRlbXMgYnkgcGF0aFxuICAgIGdldChwYXRoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5HRVQsIHBhdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyB1cGRhdGUgcmVxdWVzdCBmb3IgcGF0aFxuICAgIHVwZGF0ZShwYXRoLCBjaGFuZ2VzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5QVVQsIHBhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFjcXVpcmUgcHJveHkgY29sbGVjdGlvbiBmb3IgcGF0aFxuICAgICAqIC0gYXV0b21hdGljYWxseSBzdWJzY3JpYmVzIHRvIHBhdGggaWYgbmVlZGVkXG4gICAgICovXG4gICAgYWNxdWlyZV9jb2xsZWN0aW9uIChwYXRoLCBvcHRpb25zKSB7XG4gICAgICAgIHBhdGggPSBwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcGF0aCA6IFwiL1wiICsgcGF0aDtcbiAgICAgICAgLy8gc3Vic2NyaWJlIGlmIHN1YnNjcmlwdGlvbiBkb2VzIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9zdWJzX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIC8vIHN1YnNjcmliZSB0byBwYXRoXG4gICAgICAgICAgICB0aGlzLl9zdWIocGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY3JlYXRlIGNvbGxlY3Rpb24gaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX2NvbGxfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fY29sbF9tYXAuc2V0KHBhdGgsIG5ldyBQcm94eUNvbGxlY3Rpb24odGhpcywgcGF0aCwgb3B0aW9ucykpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9jb2xsX21hcC5nZXQocGF0aCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYWNxdWlyZSBvYmplY3QgZm9yIChwYXRoLCBuYW1lKVxuICAgICAqIC0gYXV0b21hdGljYWxseSBhY3F1aXJlIHByb3h5IGNvbGxlY3Rpb25cbiAgICAgKi9cbiAgICBhY3F1aXJlX29iamVjdCAocGF0aCwgbmFtZSwgb3B0aW9ucykge1xuICAgICAgICBwYXRoID0gcGF0aC5zdGFydHNXaXRoKFwiL1wiKSA/IHBhdGggOiBcIi9cIiArIHBhdGg7XG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5hY3F1aXJlX2NvbGxlY3Rpb24ocGF0aCk7XG4gICAgICAgIC8vIGNyZWF0ZSBwcm94eSBvYmplY3QgaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX29ial9tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl9vYmpfbWFwLnNldChwYXRoLCBuZXcgTWFwKCkpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IG9ial9tYXAgPSB0aGlzLl9vYmpfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKCFvYmpfbWFwLmdldChuYW1lKSkge1xuICAgICAgICAgICAgb2JqX21hcC5zZXQobmFtZSwgbmV3IFByb3h5T2JqZWN0KGRzLCBuYW1lLCBvcHRpb25zKSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gb2JqX21hcC5nZXQobmFtZSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiByZWxlYXNlIHBhdGgsIGluY2x1ZGluZyBwcm94eSBjb2xsZWN0aW9uIGFuZCBwcm94eSBvYmplY3RzXG4gICAgICovXG4gICAgcmVsZWFzZShwYXRoKSB7XG4gICAgICAgIC8vIHVuc3Vic2NyaWJlXG4gICAgICAgIGlmICh0aGlzLl9zdWJzX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX3Vuc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIHRlcm1pbmF0ZSBwcm94eSBjb2xsZWN0aW9uIGFuZCBwcm94eSBvYmplY3RzXG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fY29sbF9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBkcy5fc3NjbGllbnRfdGVybWluYXRlKCk7XG4gICAgICAgIGNvbnN0IG9ial9tYXAgPSB0aGlzLl9vYmpfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKG9ial9tYXAgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IHYgb2Ygb2JqX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIHYuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICAgICAgfSAgICBcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb2xsX21hcC5kZWxldGUocGF0aCk7XG4gICAgICAgIHRoaXMuX29ial9tYXAuZGVsZXRlKHBhdGgpO1xuICAgIH1cbn1cblxuXG4iLCIvKlxuICAgIENvbGxlY3Rpb24gVmlld2VyXG4qL1xuXG5mdW5jdGlvbiBpdGVtMnN0cmluZyhpdGVtKSB7XG4gICAgY29uc3Qge2lkLCBpdHYsIGRhdGF9ID0gaXRlbTtcbiAgICBsZXQgZGF0YV90eHQgPSBKU09OLnN0cmluZ2lmeShkYXRhKTtcbiAgICBsZXQgaXR2X3R4dCA9IChpdHYgIT0gdW5kZWZpbmVkKSA/IEpTT04uc3RyaW5naWZ5KGl0dikgOiBcIlwiO1xuICAgIGxldCBpZF9odG1sID0gYDxzcGFuIGNsYXNzPVwiaWRcIj4ke2lkfTwvc3Bhbj5gO1xuICAgIGxldCBpdHZfaHRtbCA9IGA8c3BhbiBjbGFzcz1cIml0dlwiPiR7aXR2X3R4dH08L3NwYW4+YDtcbiAgICBsZXQgZGF0YV9odG1sID0gYDxzcGFuIGNsYXNzPVwiZGF0YVwiPiR7ZGF0YV90eHR9PC9zcGFuPmA7XG4gICAgcmV0dXJuIGBcbiAgICAgICAgPGRpdj5cbiAgICAgICAgICAgIDxidXR0b24gaWQ9XCJkZWxldGVcIj5YPC9idXR0b24+XG4gICAgICAgICAgICAke2lkX2h0bWx9OiAke2l0dl9odG1sfSAke2RhdGFfaHRtbH1cbiAgICAgICAgPC9kaXY+YDtcbn1cblxuXG5leHBvcnQgY2xhc3MgQ29sbGVjdGlvblZpZXdlciB7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb2xsZWN0aW9uLCBlbGVtLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX2NvbGwgPSBjb2xsZWN0aW9uO1xuICAgICAgICB0aGlzLl9lbGVtID0gZWxlbTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7IFxuXG4gICAgICAgIC8vIG9wdGlvbnNcbiAgICAgICAgbGV0IGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgZGVsZXRlOmZhbHNlLFxuICAgICAgICAgICAgdG9TdHJpbmc6aXRlbTJzdHJpbmdcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHsuLi5kZWZhdWx0cywgLi4ub3B0aW9uc307XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIFN1cHBvcnQgZGVsZXRlXG4gICAgICAgICovXG4gICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmRlbGV0ZSkge1xuICAgICAgICAgICAgLy8gbGlzdGVuIGZvciBjbGljayBldmVudHMgb24gcm9vdCBlbGVtZW50XG4gICAgICAgICAgICBlbGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhdGNoIGNsaWNrIGV2ZW50IGZyb20gZGVsZXRlIGJ1dHRvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGUudGFyZ2V0LmNsb3Nlc3QoXCIjZGVsZXRlXCIpO1xuICAgICAgICAgICAgICAgIGlmIChkZWxldGVCdG4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdEl0ZW0gPSBkZWxldGVCdG4uY2xvc2VzdChcIi5saXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29sbC51cGRhdGUoe3JlbW92ZTpbbGlzdEl0ZW0uaWRdfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKlxuICAgICAgICAgICAgcmVuZGVyIGluaXRpYWwgc3RhdGVcbiAgICAgICAgKi8gXG4gICAgICAgIGNvbnN0IGRpZmZzID0gdGhpcy5fY29sbC5nZXRfaXRlbXMoKVxuICAgICAgICAgICAgLm1hcChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge2lkOml0ZW0uaWQsIG5ldzppdGVtfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuX29uY2hhbmdlKGRpZmZzKTtcbiAgICB9XG5cbiAgICBfb25jaGFuZ2UoZGlmZnMpIHtcbiAgICAgICAgY29uc3Qge3RvU3RyaW5nfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGZvciAobGV0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLm5ldykge1xuICAgICAgICAgICAgICAgIC8vIGFkZFxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiaWRcIiwgZGlmZi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChcImxpc3QtaXRlbVwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZWxlbS5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbm9kZS5pbm5lckhUTUwgPSB0b1N0cmluZyhkaWZmLm5ldyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpZmYub2xkKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgICAgICAgICAgbGV0IG5vZGUgPSB0aGlzLl9lbGVtLnF1ZXJ5U2VsZWN0b3IoYCMke2RpZmYuaWR9YCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgICAgICAgICAgIH1cbiAg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
