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
        const {id, itv, state} = item;
        let state_txt = JSON.stringify(state);
        let itv_txt = (itv != undefined) ? JSON.stringify(itv) : "";
        let id_html = `<span class="id">${id}</span>`;
        let itv_html = `<span class="itv">${itv_txt}</span>`;
        let state_html = `<span class="state">${state_txt}</span>`;
        return `
        <div>
            <button id="delete">X</button>
            ${id_html}: ${itv_html} ${state_html}
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
                            this._coll.update_items({remove:[listItem.id]});
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vY2xpZW50L3V0aWwuanMiLCIuLi8uLi9jbGllbnQvd3Npby5qcyIsIi4uLy4uL2NsaWVudC9zc19jb2xsZWN0aW9uLmpzIiwiLi4vLi4vY2xpZW50L3NzX29iamVjdC5qcyIsIi4uLy4uL2NsaWVudC9zZXJ2ZXJjbG9jay5qcyIsIi4uLy4uL2NsaWVudC9zc19jbGllbnQuanMiLCIuLi8uLi9jbGllbnQvdmlld2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gICAgQ3JlYXRlIGEgcHJvbWlzZSB3aGljaCBjYW4gYmUgcmVzb2x2ZWRcbiAgICBwcm9ncmFtbWF0aWNhbGx5IGJ5IGV4dGVybmFsIGNvZGUuXG4gICAgUmV0dXJuIGEgcHJvbWlzZSBhbmQgYSByZXNvbHZlIGZ1bmN0aW9uXG4qL1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2YWJsZVByb21pc2UoKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICByZXNvbHZlciA9IHJlc29sdmU7XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0UHJvbWlzZSAobXMpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGxldCB0aWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgIH0sIG1zKTtcbiAgICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGlkKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByYW5kb21fc3RyaW5nKGxlbmd0aCkge1xuICAgIHZhciB0ZXh0ID0gXCJcIjtcbiAgICB2YXIgcG9zc2libGUgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpcIjtcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGV4dCArPSBwb3NzaWJsZS5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9zc2libGUubGVuZ3RoKSk7XG4gICAgfVxuICAgIHJldHVybiB0ZXh0O1xufSIsImltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuXG5jb25zdCBNQVhfUkVUUklFUyA9IDQ7XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdXJsID0gdXJsO1xuICAgICAgICB0aGlzLl93cztcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgfVxuXG4gICAgZ2V0IGNvbm5lY3RpbmcoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3Rpbmc7fVxuICAgIGdldCBjb25uZWN0ZWQoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3RlZDt9XG4gICAgZ2V0IHVybCgpIHtyZXR1cm4gdGhpcy5fdXJsO31cbiAgICBnZXQgb3B0aW9ucygpIHtyZXR1cm4gdGhpcy5fb3B0aW9uczt9XG5cbiAgICBjb25uZWN0KCkge1xuXG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RpbmcgfHwgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ29ubmVjdCB3aGlsZSBjb25uZWN0aW5nIG9yIGNvbm5lY3RlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIlRlcm1pbmF0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25uZWN0aW5nXG4gICAgICAgIHRoaXMuX3dzID0gbmV3IFdlYlNvY2tldCh0aGlzLl91cmwpO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gZSA9PiB0aGlzLl9vbl9vcGVuKGUpO1xuICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSBlID0+IHRoaXMub25fbWVzc2FnZShlLmRhdGEpO1xuICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gZSA9PiB0aGlzLl9vbl9jbG9zZShlKTtcbiAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IGUgPT4gdGhpcy5vbl9lcnJvcihlKTtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0aW5nKCk7XG4gICAgfVxuXG4gICAgX29uX29wZW4oZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAvLyByZWxlYXNlIGNvbm5lY3QgcHJvbWlzZXNcbiAgICAgICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICAgICAgLy8gcmVzZXQgcmV0cmllcyBvbiBzdWNjZXNzZnVsIGNvbm5lY3Rpb25cbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMub25fY29ubmVjdCgpO1xuICAgIH1cblxuICAgIF9vbl9jbG9zZShldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLm9uX2Rpc2Nvbm5lY3QoZXZlbnQpO1xuICAgICAgICB0aGlzLl9yZXRyaWVzICs9IDE7XG4gICAgICAgIGlmICghdGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICAgICAgICAgIH0sIDEwMDAgKiB0aGlzLl9yZXRyaWVzKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBfaXNfdGVybWluYXRlZCgpIHtcbiAgICAgICAgY29uc3Qge3JldHJpZXM9TUFYX1JFVFJJRVN9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKHRoaXMuX3JldHJpZXMgPj0gcmV0cmllcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFRlcm1pbmF0ZWQ6IE1heCByZXRyaWVzIHJlYWNoZWQgKCR7cmV0cmllc30pYCk7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cyA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBvbl9jb25uZWN0aW5nKCkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbm5lY3RpbmcgJHt0aGlzLnVybH1gKTt9XG4gICAgfVxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdChldmVudCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYFJlY2VpdmU6ICR7ZGF0YX1gKTt9XG4gICAgfVxuXG4gICAgc2VuZChkYXRhKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fd3Muc2VuZChkYXRhKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU2VuZCBmYWlsOiAke2Vycm9yfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbmQgZHJvcCA6IG5vdCBjb25uZWN0ZWRgKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29ubmVjdGVkUHJvbWlzZSgpIHtcbiAgICAgICAgY29uc3QgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMucHVzaChyZXNvbHZlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IHJhbmRvbV9zdHJpbmcgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmV4cG9ydCBjbGFzcyBQcm94eUNvbGxlY3Rpb24ge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogQ29sbGVjdGlvbiByZWxlYXNlZCBieSBzcyBjbGllbnRcbiAgICAgKi9cblxuICAgIF9zc2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICAvLyBlbXB0eSBjb2xsZWN0aW9uP1xuICAgICAgICAvLyBkaXNjb25uZWN0IGZyb20gb2JzZXJ2ZXJzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBjb2xsZWN0aW9uIFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiY29sbGVjdGlvbiBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHtyZW1vdmUsIGluc2VydCwgcmVzZXQ9ZmFsc2V9ID0gY2hhbmdlcztcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlIGl0ZW1zIC0gY3JlYXRlIGRpZmZcbiAgICAgICAgaWYgKHJlc2V0KSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdGhpcy5fbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KFxuICAgICAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICAgICAge2lkOiBpdGVtLmlkLCBuZXc6dW5kZWZpbmVkLCBvbGQ6aXRlbX1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBfaWQgb2YgcmVtb3ZlKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb2xkID0gdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcC5kZWxldGUoX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3OnVuZGVmaW5lZCwgb2xkfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0IGl0ZW1zIC0gdXBkYXRlIGRpZmZcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGluc2VydCkge1xuICAgICAgICAgICAgY29uc3QgX2lkID0gaXRlbS5pZDtcbiAgICAgICAgICAgIC8vIG9sZCBmcm9tIGRpZmZfbWFwIG9yIF9tYXBcbiAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBkaWZmX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IChkaWZmICE9IHVuZGVmaW5lZCkgPyBkaWZmLm9sZCA6IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIC8vIHNldCBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5fbWFwLnNldChfaWQsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gdXBkYXRlIGRpZmYgbWFwXG4gICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6aXRlbSwgb2xkfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5X2NhbGxiYWNrcyhbLi4uZGlmZl9tYXAudmFsdWVzKCldKTtcbiAgICB9XG5cbiAgICBfbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQUExJQ0FUSU9OIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9XG4gICAgaGFzX2l0ZW0oaWQpIHtyZXR1cm4gdGhpcy5fbWFwLmhhcyhpZCl9XG4gICAgZ2V0X2l0ZW0oaWQpIHtyZXR1cm4gdGhpcy5fbWFwLmdldChpZCl9XG4gICAgZ2V0X2l0ZW1zKCkge3JldHVybiBbLi4udGhpcy5fbWFwLnZhbHVlcygpXX1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIGRpc3BhdGNoaW5nIHVwZGF0ZSB0byBzZXJ2ZXJcbiAgICAgKi9cbiAgICB1cGRhdGVfaXRlbXMgKGNoYW5nZXM9e30pIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbGxlY3Rpb24gYWxyZWFkeSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgLy8gZW5zdXJlIHRoYXQgaW5zZXJ0ZWQgaXRlbXMgaGF2ZSBpZHNcbiAgICAgICAgY29uc3Qge2luc2VydD1bXX0gPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzLmluc2VydCA9IGluc2VydC5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW0uaWQgPSBpdGVtLmlkIHx8IHJhbmRvbV9zdHJpbmcoMTApO1xuICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGhpcy5fc3NjbGllbnQudXBkYXRlKHRoaXMuX3BhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIHJlZ2lzdGVyIGNhbGxiYWNrXG4gICAgKi9cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTsgICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTsgICAgXG59IiwiLyoqXG4gKiBQcm94eSBPYmplY3RcbiAqIFxuICogQ2xpZW50LXNpZGUgcHJveHkgb2JqZWN0IGZvciBhIHNlcnZlci1zaWRlIG9iamVjdC5cbiAqXG4gKiBJbXBsZW1lbnRhdGlvbiBsZXZlcmFnZXMgUHJveHlDb2xsZWN0aW9uLiBBcyBzdWNoLCB0aGUgdmFsdWUgb2YgdGhlIHByb3h5IG9iamVjdFxuICogY29ycmVzcG9uZHMgdG8gdGhlIHN0YXRlIHByb3BlcnR5IG9mIGEgc2luZ2xlIGl0ZW0gd2l0aCAqaWQqIHdpdGhpbiBhIFxuICogc3BlY2lmaWMgc2VydmVyLXNpZGUgY29sbGVjdGlvbi4gSWYgbm8gaXRlbSB3aXRoICppZCogZXhpc3RzIGluIHRoZSBjb2xsZWN0aW9uLCB0aGVcbiAqIHZhbHVlIG9mIHRoZSBwcm94eSBvYmplY3QgaXMgdW5kZWZpbmVkLiBcbiAqIFxuICogUHJveHlPYmplY3QgbWFuYWdlcyBhIHNldCBvZiBpdGVtcyAoYW4gYXJyYXkpIHN0b3JlZCB3aXRoaW4gYSBzaW5nbGUgaXRlbSdzIHN0YXRlLlxuICogXG4gKiBzZXRfaXRlbXMoKSBzZXRzIHRoZSBlbnRpcmUgYXJyYXkgb2YgaXRlbXMuXG4gKiBnZXRfaXRlbXMoKSByZXR1cm5zIGFsbCBpdGVtcyBpbiB0aGUgYXJyYXkuXG4gKiBnZXRfaXRlbShpZCkgcmV0dXJucyBhIHNpbmdsZSBpdGVtIGZyb20gdGhlIGFycmF5LlxuICogaGFzX2l0ZW0oaWQpIHJldHVybnMgdHJ1ZSBpZiBhbiBpdGVtIHdpdGggaWQgZXhpc3RzIGluIHRoZSBhcnJheS5cbiAqIFxuICovXG5cbmV4cG9ydCBjbGFzcyBQcm94eU9iamVjdCB7XG5cbiAgICBjb25zdHJ1Y3Rvcihwcm94eUNvbGxlY3Rpb24sIGlkLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29sbCA9IHByb3h5Q29sbGVjdGlvbjtcbiAgICAgICAgdGhpcy5faWQgPSBpZDtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIC8vIGNhbGxiYWNrXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIF9vbmNoYW5nZShkaWZmcykge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwicHJveHkgb2JqZWN0IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuICAgICAgICBmb3IgKGNvbnN0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLmlkID09IHRoaXMuX2lkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5ub3RpZnlfY2FsbGJhY2tzKGRpZmYpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkX2NhbGxiYWNrIChoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtoYW5kbGVyOiBoYW5kbGVyfTtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMucHVzaChoYW5kbGUpO1xuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG4gICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5faGFuZGxlcnMuaW5kZXhPZihoYW5kbGUpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5faGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgXG4gICAgbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICBzZXRfaXRlbXMgKGl0ZW1zKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJwcm94eSBvYmplY3QgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGlmICghQXJyYXkuaXNBcnJheShpdGVtcykpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcIml0ZW1zIG11c3QgYmUgYW4gYXJyYXlcIilcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBpbnNlcnRJdGVtcyA9IFt7aWQ6dGhpcy5faWQsIHN0YXRlOml0ZW1zfV07XG4gICAgICAgIHJldHVybiB0aGlzLl9jb2xsLnVwZGF0ZV9pdGVtcyh7aW5zZXJ0Omluc2VydEl0ZW1zLCByZXNldDpmYWxzZX0pO1xuICAgIH1cblxuICAgIGdldF9pdGVtcyAoKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb2xsLmhhc19pdGVtKHRoaXMuX2lkKSkge1xuICAgICAgICAgICAgY29uc3QgaXRlbSA9IHRoaXMuX2NvbGwuZ2V0X2l0ZW0odGhpcy5faWQpO1xuICAgICAgICAgICAgcmV0dXJuIChpdGVtICYmIGl0ZW0uc3RhdGUpID8gaXRlbS5zdGF0ZSA6IFtdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIFtdO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgZ2V0X2l0ZW0gKGlkKSB7XG4gICAgICAgIGNvbnN0IGl0ZW1zID0gdGhpcy5nZXRfaXRlbXMoKTtcbiAgICAgICAgcmV0dXJuIGl0ZW1zLmZpbmQoaXRlbSA9PiBpdGVtLmlkID09PSBpZCk7XG4gICAgfVxuXG4gICAgaGFzX2l0ZW0gKGlkKSB7XG4gICAgICAgIHJldHVybiB0aGlzLmdldF9pdGVtKGlkKSAhPT0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICBcbiAgICBzc19jbGllbnRfdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fY29sbC5yZW1vdmVfY2FsbGJhY2sodGhpcy5faGFuZGxlKTtcbiAgICB9XG59IiwiLy8gd2VicGFnZSBjbG9jayAtIHBlcmZvcm1hbmNlIG5vdyAtIHNlY29uZHNcbmNvbnN0IGxvY2FsID0ge1xuICAgIG5vdzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwZXJmb3JtYW5jZS5ub3coKS8xMDAwLjA7XG4gICAgfVxufVxuLy8gc3lzdGVtIGNsb2NrIC0gZXBvY2ggLSBzZWNvbmRzXG5jb25zdCBlcG9jaCA9IHtcbiAgICBub3c6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbmV3IERhdGUoKS8xMDAwLjA7XG4gICAgfVxufVxuXG4vKipcbiAqIENMT0NLIGdpdmVzIGVwb2NoIHZhbHVlcywgYnV0IGlzIGltcGxlbWVudGVkXG4gKiB1c2luZyBwZXJmb3JtYW5jZSBub3cgZm9yIGJldHRlclxuICogdGltZSByZXNvbHV0aW9uIGFuZCBwcm90ZWN0aW9uIGFnYWluc3Qgc3lzdGVtIFxuICogdGltZSBhZGp1c3RtZW50cy5cbiAqL1xuXG5jb25zdCBDTE9DSyA9IGZ1bmN0aW9uICgpIHtcbiAgICBjb25zdCB0MF9sb2NhbCA9IGxvY2FsLm5vdygpO1xuICAgIGNvbnN0IHQwX2Vwb2NoID0gZXBvY2gubm93KCk7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgbm93OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjb25zdCB0MV9sb2NhbCA9IGxvY2FsLm5vdygpO1xuICAgICAgICAgICAgcmV0dXJuIHQwX2Vwb2NoICsgKHQxX2xvY2FsIC0gdDBfbG9jYWwpO1xuICAgICAgICB9XG4gICAgfTtcbn0oKTtcblxuXG4vKipcbiAqIEVzdGltYXRlIHRoZSBjbG9jayBvZiB0aGUgc2VydmVyIFxuICovXG5cbmNvbnN0IE1BWF9TQU1QTEVfQ09VTlQgPSAzMDtcblxuZXhwb3J0IGNsYXNzIFNlcnZlckNsb2NrIHtcblxuICAgIGNvbnN0cnVjdG9yKHNzY2xpZW50KSB7XG4gICAgICAgIC8vIHNoYXJlc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIC8vIHBpbmdlclxuICAgICAgICB0aGlzLl9waW5nZXIgPSBuZXcgUGluZ2VyKHRoaXMuX29ucGluZy5iaW5kKHRoaXMpKTtcbiAgICAgICAgLy8gc2FtcGxlc1xuICAgICAgICB0aGlzLl9zYW1wbGVzID0gW107XG4gICAgICAgIC8vIGVzdGltYXRlc1xuICAgICAgICB0aGlzLl90cmFucyA9IDEwMDAuMDtcbiAgICAgICAgdGhpcy5fc2tldyA9IDAuMDtcbiAgICB9XG5cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIHRoaXMuX3Bpbmdlci5yZXN1bWUoKTtcbiAgICB9XG5cbiAgICBwYXVzZSgpIHtcbiAgICAgICAgdGhpcy5fcGluZ2VyLnBhdXNlKCk7XG4gICAgfVxuXG4gICAgX29ucGluZygpIHtcbiAgICAgICAgY29uc3QgdHMwID0gQ0xPQ0subm93KCk7XG4gICAgICAgIHRoaXMuX3NzY2xpZW50LmdldChcIi9jbG9ja1wiKS50aGVuKCh7b2ssIGRhdGF9KSA9PiB7XG4gICAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0czEgPSBDTE9DSy5ub3coKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9hZGRfc2FtcGxlKHRzMCwgZGF0YSwgdHMxKTsgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9hZGRfc2FtcGxlKGNzLCBzcywgY3IpIHtcbiAgICAgICAgbGV0IHRyYW5zID0gKGNyIC0gY3MpIC8gMi4wO1xuICAgICAgICBsZXQgc2tldyA9IHNzIC0gKGNyICsgY3MpIC8gMi4wO1xuICAgICAgICBsZXQgc2FtcGxlID0gW2NzLCBzcywgY3IsIHRyYW5zLCBza2V3XTtcbiAgICAgICAgLy8gYWRkIHRvIHNhbXBsZXNcbiAgICAgICAgdGhpcy5fc2FtcGxlcy5wdXNoKHNhbXBsZSlcbiAgICAgICAgaWYgKHRoaXMuX3NhbXBsZXMubGVuZ3RoID4gTUFYX1NBTVBMRV9DT1VOVCkge1xuICAgICAgICAgICAgLy8gcmVtb3ZlIGZpcnN0IHNhbXBsZVxuICAgICAgICAgICAgdGhpcy5fc2FtcGxlcy5zaGlmdCgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIHJlZXZhbHVhdGUgZXN0aW1hdGVzIGZvciBza2V3IGFuZCB0cmFuc1xuICAgICAgICB0cmFucyA9IDEwMDAwMC4wO1xuICAgICAgICBza2V3ID0gMC4wO1xuICAgICAgICBmb3IgKGNvbnN0IHNhbXBsZSBvZiB0aGlzLl9zYW1wbGVzKSB7XG4gICAgICAgICAgICBpZiAoc2FtcGxlWzNdIDwgdHJhbnMpIHtcbiAgICAgICAgICAgICAgICB0cmFucyA9IHNhbXBsZVszXTtcbiAgICAgICAgICAgICAgICBza2V3ID0gc2FtcGxlWzRdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3NrZXcgPSBza2V3O1xuICAgICAgICB0aGlzLl90cmFucyA9IHRyYW5zO1xuICAgIH1cblxuICAgIGdldCBza2V3KCkge3JldHVybiB0aGlzLl9za2V3O31cbiAgICBnZXQgdHJhbnMoKSB7cmV0dXJuIHRoaXMuX3RyYW5zO31cblxuICAgIG5vdygpIHtcbiAgICAgICAgLy8gc2VydmVyIGNsb2NrIGlzIGxvY2FsIGNsb2NrICsgZXN0aW1hdGVkIHNrZXdcbiAgICAgICAgcmV0dXJuIENMT0NLLm5vdygpICsgdGhpcy5fc2tldztcbiAgICB9XG5cbn1cblxuXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgUElOR0VSXG4qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4vKipcbiAqIFBpbmdlciBpbnZva2VzIGEgY2FsbGJhY2sgcmVwZWF0ZWRseSwgaW5kZWZpbml0ZWx5LiBcbiAqIFBpbmdpbmcgaW4gMyBzdGFnZXMsIGZpcnN0IGZyZXF1ZW50bHksIHRoZW4gbW9kZXJhdGVseSwgXG4gKiB0aGVuIHNsb3dseS5cbiAqL1xuXG5jb25zdCBTTUFMTF9ERUxBWSA9IDIwOyAvLyBtc1xuY29uc3QgTUVESVVNX0RFTEFZID0gNTAwOyAvLyBtc1xuY29uc3QgTEFSR0VfREVMQVkgPSAxMDAwMDsgLy8gbXNcblxuY29uc3QgREVMQVlfU0VRVUVOQ0UgPSBbXG4gICAgLi4ubmV3IEFycmF5KDMpLmZpbGwoU01BTExfREVMQVkpLCBcbiAgICAuLi5uZXcgQXJyYXkoNykuZmlsbChNRURJVU1fREVMQVkpLFxuICAgIC4uLltMQVJHRV9ERUxBWV1cbl07XG5cbmNsYXNzIFBpbmdlciB7XG5cbiAgICBjb25zdHJ1Y3RvciAoY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5fY291bnQgPSAwO1xuICAgICAgICB0aGlzLl90aWQgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuX2NhbGxiYWNrID0gY2FsbGJhY2s7XG4gICAgICAgIHRoaXMuX3BpbmcgPSB0aGlzLnBpbmcuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5fZGVsYXlzID0gWy4uLkRFTEFZX1NFUVVFTkNFXTtcbiAgICB9XG4gICAgcGF1c2UoKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgIH1cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgICAgICB0aGlzLnBpbmcoKTtcbiAgICB9XG4gICAgcmVzdGFydCgpIHtcbiAgICAgICAgdGhpcy5fZGVsYXlzID0gWy4uLkRFTEFZX1NFUVVFTkNFXTtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgICAgIHRoaXMucGluZygpO1xuICAgIH1cbiAgICBwaW5nICgpIHtcbiAgICAgICAgbGV0IG5leHRfZGVsYXkgPSB0aGlzLl9kZWxheXNbMF07XG4gICAgICAgIGlmICh0aGlzLl9kZWxheXMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy5fZGVsYXlzLnNoaWZ0KCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2NhbGxiYWNrKSB7XG4gICAgICAgICAgICB0aGlzLl9jYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3RpZCA9IHNldFRpbWVvdXQodGhpcy5fcGluZywgbmV4dF9kZWxheSk7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IFdlYlNvY2tldElPIH0gZnJvbSBcIi4vd3Npby5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5pbXBvcnQgeyBQcm94eUNvbGxlY3Rpb24gfSBmcm9tIFwiLi9zc19jb2xsZWN0aW9uLmpzXCI7XG5pbXBvcnQgeyBQcm94eU9iamVjdCB9IGZyb20gXCIuL3NzX29iamVjdC5qc1wiO1xuaW1wb3J0IHsgU2VydmVyQ2xvY2sgfSBmcm9tIFwiLi9zZXJ2ZXJjbG9jay5qc1wiO1xuXG5jb25zdCBNc2dUeXBlID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgTUVTU0FHRSA6IFwiTUVTU0FHRVwiLFxuICAgIFJFUVVFU1Q6IFwiUkVRVUVTVFwiLFxuICAgIFJFUExZOiBcIlJFUExZXCJcbiB9KTtcbiBcbmNvbnN0IE1zZ0NtZCA9IE9iamVjdC5mcmVlemUoe1xuICAgIEdFVCA6IFwiR0VUXCIsXG4gICAgUFVUOiBcIlBVVFwiLFxuICAgIE5PVElGWTogXCJOT1RJRllcIlxufSk7XG5cblxuZXhwb3J0IGNsYXNzIFNoYXJlZFN0YXRlQ2xpZW50IGV4dGVuZHMgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IgKHVybCwgb3B0aW9ucykge1xuICAgICAgICBzdXBlcih1cmwsIG9wdGlvbnMpO1xuXG4gICAgICAgIC8vIHJlcXVlc3RzXG4gICAgICAgIHRoaXMuX3JlcWlkID0gMDtcbiAgICAgICAgdGhpcy5fcGVuZGluZyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBzdWJzY3JpcHRpb25zXG4gICAgICAgIC8vIHBhdGggLT4ge30gXG4gICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHByb3h5IGNvbGxlY3Rpb25zIHtwYXRoIC0+IHByb3h5IGNvbGxlY3Rpb259XG4gICAgICAgIHRoaXMuX2NvbGxfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHByb3h5IG9iamVjdHMge1twYXRoLCBpZF0gLT4gcHJveHkgb2JqZWN0fVxuICAgICAgICB0aGlzLl9vYmpfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2s7XG5cbiAgICAgICAgdGhpcy5jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBDT05ORUNUSU9OIFxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgICAgICAvLyByZWZyZXNoIGxvY2FsIHN1c2NyaXB0aW9uc1xuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuc2l6ZSA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnRoaXMuX3N1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2tcbiAgICAgICAgaWYgKHRoaXMuX3NlcnZlcl9jbG9jayAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jay5yZXN1bWUoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnBhdXNlKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZXJyb3IoZXJyb3IpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBDb21tdW5pY2F0aW9uIEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEhBTkRMRVJTXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGxldCBtc2cgPSBKU09OLnBhcnNlKGRhdGEpO1xuICAgICAgICBpZiAobXNnLnR5cGUgPT0gTXNnVHlwZS5SRVBMWSkge1xuICAgICAgICAgICAgbGV0IHJlcWlkID0gbXNnLnR1bm5lbDtcbiAgICAgICAgICAgIGlmICh0aGlzLl9wZW5kaW5nLmhhcyhyZXFpZCkpIHtcbiAgICAgICAgICAgICAgICBsZXQgcmVzb2x2ZXIgPSB0aGlzLl9wZW5kaW5nLmdldChyZXFpZCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fcGVuZGluZy5kZWxldGUocmVxaWQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHtvaywgZGF0YX0gPSBtc2c7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZXIoe29rLCBkYXRhfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobXNnLnR5cGUgPT0gTXNnVHlwZS5NRVNTQUdFKSB7XG4gICAgICAgICAgICBpZiAobXNnLmNtZCA9PSBNc2dDbWQuTk9USUZZKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5faGFuZGxlX25vdGlmeShtc2cpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgX2hhbmRsZV9ub3RpZnkobXNnKSB7XG4gICAgICAgIC8vIHVwZGF0ZSBwcm94eSBjb2xsZWN0aW9uIHN0YXRlXG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fY29sbF9tYXAuZ2V0KG1zZ1tcInBhdGhcIl0pO1xuICAgICAgICBpZiAoZHMgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkcy5fc3NjbGllbnRfdXBkYXRlKG1zZ1tcImRhdGFcIl0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBTRVJWRVIgUkVRVUVTVFNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBfcmVxdWVzdChjbWQsIHBhdGgsIGFyZykge1xuICAgICAgICBjb25zdCByZXFpZCA9IHRoaXMuX3JlcWlkKys7XG4gICAgICAgIGNvbnN0IG1zZyA9IHtcbiAgICAgICAgICAgIHR5cGU6IE1zZ1R5cGUuUkVRVUVTVCxcbiAgICAgICAgICAgIGNtZCwgXG4gICAgICAgICAgICBwYXRoLCBcbiAgICAgICAgICAgIGFyZyxcbiAgICAgICAgICAgIHR1bm5lbDogcmVxaWRcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5zZW5kKEpTT04uc3RyaW5naWZ5KG1zZykpO1xuICAgICAgICBsZXQgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcuc2V0KHJlcWlkLCByZXNvbHZlcik7XG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIC8vIHNwZWNpYWwgaGFuZGxpbmcgZm9yIHJlcGxpZXMgdG8gUFVUIC9zdWJzXG4gICAgICAgICAgICBpZiAoY21kID09IE1zZ0NtZC5QVVQgJiYgcGF0aCA9PSBcIi9zdWJzXCIgJiYgb2spIHtcbiAgICAgICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3Vic2NyaXB0aW9uIHN0YXRlXG4gICAgICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKGRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge29rLCBwYXRoLCBkYXRhfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3N1YiAocGF0aCkge1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgICAgICAvLyBzZXQgbmV3IHBhdGhcbiAgICAgICAgICAgIHN1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzIC0gc3Vic2NyaWJlIG9uIHJlY29ubmVjdFxuICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe29rOiB0cnVlLCBwYXRoLCBkYXRhOnVuZGVmaW5lZH0pXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIF91bnN1YiAocGF0aCkge1xuICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgIC8vIHJlbW92ZSBwYXRoXG4gICAgICAgIHN1YnNfbWFwLmRlbGV0ZShwYXRoKVxuICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi5zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICAvLyBhY2NzZXNzb3IgZm9yIHNlcnZlciBjbG9ja1xuICAgIGdldCBjbG9jaygpIHtcbiAgICAgICAgaWYgKHRoaXMuX3NlcnZlcl9jbG9jayA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jayA9IG5ldyBTZXJ2ZXJDbG9jayh0aGlzKTtcbiAgICAgICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jay5yZXN1bWUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fc2VydmVyX2Nsb2NrO1xuICAgIH1cblxuICAgIC8vIGdldCByZXF1ZXN0IGZvciBpdGVtcyBieSBwYXRoXG4gICAgZ2V0KHBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLkdFVCwgcGF0aCk7XG4gICAgfVxuICAgIFxuICAgIC8vIHVwZGF0ZSByZXF1ZXN0IGZvciBwYXRoXG4gICAgdXBkYXRlKHBhdGgsIGNoYW5nZXMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLlBVVCwgcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYWNxdWlyZSBwcm94eSBjb2xsZWN0aW9uIGZvciBwYXRoXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHN1YnNjcmliZXMgdG8gcGF0aCBpZiBuZWVkZWRcbiAgICAgKi9cbiAgICBhY3F1aXJlX2NvbGxlY3Rpb24gKHBhdGgsIG9wdGlvbnMpIHtcbiAgICAgICAgcGF0aCA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoIDogXCIvXCIgKyBwYXRoO1xuICAgICAgICAvLyBzdWJzY3JpYmUgaWYgc3Vic2NyaXB0aW9uIGRvZXMgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgLy8gc3Vic2NyaWJlIHRvIHBhdGhcbiAgICAgICAgICAgIHRoaXMuX3N1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgY29sbGVjdGlvbiBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fY29sbF9tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl9jb2xsX21hcC5zZXQocGF0aCwgbmV3IFByb3h5Q29sbGVjdGlvbih0aGlzLCBwYXRoLCBvcHRpb25zKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIG9iamVjdCBmb3IgKHBhdGgsIG5hbWUpXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IGFjcXVpcmUgcHJveHkgY29sbGVjdGlvblxuICAgICAqL1xuICAgIGFjcXVpcmVfb2JqZWN0IChwYXRoLCBuYW1lLCBvcHRpb25zKSB7XG4gICAgICAgIHBhdGggPSBwYXRoLnN0YXJ0c1dpdGgoXCIvXCIpID8gcGF0aCA6IFwiL1wiICsgcGF0aDtcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLmFjcXVpcmVfY29sbGVjdGlvbihwYXRoKTtcbiAgICAgICAgLy8gY3JlYXRlIHByb3h5IG9iamVjdCBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fb2JqX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX29ial9tYXAuc2V0KHBhdGgsIG5ldyBNYXAoKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgb2JqX21hcCA9IHRoaXMuX29ial9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAoIW9ial9tYXAuZ2V0KG5hbWUpKSB7XG4gICAgICAgICAgICBvYmpfbWFwLnNldChuYW1lLCBuZXcgUHJveHlPYmplY3QoZHMsIG5hbWUsIG9wdGlvbnMpKVxuICAgICAgICB9XG4gICAgICAgIHJldHVybiBvYmpfbWFwLmdldChuYW1lKVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHJlbGVhc2UgcGF0aCwgaW5jbHVkaW5nIHByb3h5IGNvbGxlY3Rpb24gYW5kIHByb3h5IG9iamVjdHNcbiAgICAgKi9cbiAgICByZWxlYXNlKHBhdGgpIHtcbiAgICAgICAgLy8gdW5zdWJzY3JpYmVcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fdW5zdWIocGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gdGVybWluYXRlIHByb3h5IGNvbGxlY3Rpb24gYW5kIHByb3h5IG9iamVjdHNcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9jb2xsX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGRzLl9zc2NsaWVudF90ZXJtaW5hdGUoKTtcbiAgICAgICAgY29uc3Qgb2JqX21hcCA9IHRoaXMuX29ial9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAob2JqX21hcCAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgdiBvZiBvYmpfbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgdi5fc3NjbGllbnRfdGVybWluYXRlKCk7XG4gICAgICAgICAgICB9ICAgIFxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2NvbGxfbWFwLmRlbGV0ZShwYXRoKTtcbiAgICAgICAgdGhpcy5fb2JqX21hcC5kZWxldGUocGF0aCk7XG4gICAgfVxufVxuXG5cbiIsIi8qXG4gICAgQ29sbGVjdGlvbiBWaWV3ZXJcbiovXG5cbmZ1bmN0aW9uIGl0ZW0yc3RyaW5nKGl0ZW0pIHtcbiAgICBjb25zdCB7aWQsIGl0diwgc3RhdGV9ID0gaXRlbTtcbiAgICBsZXQgc3RhdGVfdHh0ID0gSlNPTi5zdHJpbmdpZnkoc3RhdGUpO1xuICAgIGxldCBpdHZfdHh0ID0gKGl0diAhPSB1bmRlZmluZWQpID8gSlNPTi5zdHJpbmdpZnkoaXR2KSA6IFwiXCI7XG4gICAgbGV0IGlkX2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpZFwiPiR7aWR9PC9zcGFuPmA7XG4gICAgbGV0IGl0dl9odG1sID0gYDxzcGFuIGNsYXNzPVwiaXR2XCI+JHtpdHZfdHh0fTwvc3Bhbj5gO1xuICAgIGxldCBzdGF0ZV9odG1sID0gYDxzcGFuIGNsYXNzPVwic3RhdGVcIj4ke3N0YXRlX3R4dH08L3NwYW4+YDtcbiAgICByZXR1cm4gYFxuICAgICAgICA8ZGl2PlxuICAgICAgICAgICAgPGJ1dHRvbiBpZD1cImRlbGV0ZVwiPlg8L2J1dHRvbj5cbiAgICAgICAgICAgICR7aWRfaHRtbH06ICR7aXR2X2h0bWx9ICR7c3RhdGVfaHRtbH1cbiAgICAgICAgPC9kaXY+YDtcbn1cblxuXG5leHBvcnQgY2xhc3MgQ29sbGVjdGlvblZpZXdlciB7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb2xsZWN0aW9uLCBlbGVtLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX2NvbGwgPSBjb2xsZWN0aW9uO1xuICAgICAgICB0aGlzLl9lbGVtID0gZWxlbTtcbiAgICAgICAgdGhpcy5faGFuZGxlID0gdGhpcy5fY29sbC5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7IFxuXG4gICAgICAgIC8vIG9wdGlvbnNcbiAgICAgICAgbGV0IGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgZGVsZXRlOmZhbHNlLFxuICAgICAgICAgICAgdG9TdHJpbmc6aXRlbTJzdHJpbmdcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHsuLi5kZWZhdWx0cywgLi4ub3B0aW9uc307XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIFN1cHBvcnQgZGVsZXRlXG4gICAgICAgICovXG4gICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmRlbGV0ZSkge1xuICAgICAgICAgICAgLy8gbGlzdGVuIGZvciBjbGljayBldmVudHMgb24gcm9vdCBlbGVtZW50XG4gICAgICAgICAgICBlbGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhdGNoIGNsaWNrIGV2ZW50IGZyb20gZGVsZXRlIGJ1dHRvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGUudGFyZ2V0LmNsb3Nlc3QoXCIjZGVsZXRlXCIpO1xuICAgICAgICAgICAgICAgIGlmIChkZWxldGVCdG4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdEl0ZW0gPSBkZWxldGVCdG4uY2xvc2VzdChcIi5saXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fY29sbC51cGRhdGVfaXRlbXMoe3JlbW92ZTpbbGlzdEl0ZW0uaWRdfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvKlxuICAgICAgICAgICAgcmVuZGVyIGluaXRpYWwgc3RhdGVcbiAgICAgICAgKi8gXG4gICAgICAgIGNvbnN0IGRpZmZzID0gdGhpcy5fY29sbC5nZXRfaXRlbXMoKVxuICAgICAgICAgICAgLm1hcChpdGVtID0+IHtcbiAgICAgICAgICAgICAgICByZXR1cm4ge2lkOml0ZW0uaWQsIG5ldzppdGVtfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuX29uY2hhbmdlKGRpZmZzKTtcbiAgICB9XG5cbiAgICBfb25jaGFuZ2UoZGlmZnMpIHtcbiAgICAgICAgY29uc3Qge3RvU3RyaW5nfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGZvciAobGV0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLm5ldykge1xuICAgICAgICAgICAgICAgIC8vIGFkZFxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiaWRcIiwgZGlmZi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChcImxpc3QtaXRlbVwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZWxlbS5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbm9kZS5pbm5lckhUTUwgPSB0b1N0cmluZyhkaWZmLm5ldyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpZmYub2xkKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgICAgICAgICAgbGV0IG5vZGUgPSB0aGlzLl9lbGVtLnF1ZXJ5U2VsZWN0b3IoYCMke2RpZmYuaWR9YCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7SUFBQTtJQUNBO0lBQ0E7SUFDQTtJQUNBOztJQUVPLFNBQVMsaUJBQWlCLEdBQUc7SUFDcEMsSUFBSSxJQUFJLFFBQVE7SUFDaEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEtBQUs7SUFDbkQsUUFBUSxRQUFRLEdBQUcsT0FBTztJQUMxQixLQUFLLENBQUM7SUFDTixJQUFJLE9BQU8sQ0FBQyxP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
