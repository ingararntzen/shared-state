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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NsaWVudC91dGlsLmpzIiwiLi4vLi4vc3JjL2NsaWVudC93c2lvLmpzIiwiLi4vLi4vc3JjL2NsaWVudC9jb2xsZWN0aW9uLmpzIiwiLi4vLi4vc3JjL2NsaWVudC92YXJpYWJsZS5qcyIsIi4uLy4uL3NyYy9jbGllbnQvc2VydmVyY2xvY2suanMiLCIuLi8uLi9zcmMvY2xpZW50L3NzX2NsaWVudC5qcyIsIi4uLy4uL3NyYy9jbGllbnQvdmlld2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gICAgQ3JlYXRlIGEgcHJvbWlzZSB3aGljaCBjYW4gYmUgcmVzb2x2ZWRcbiAgICBwcm9ncmFtbWF0aWNhbGx5IGJ5IGV4dGVybmFsIGNvZGUuXG4gICAgUmV0dXJuIGEgcHJvbWlzZSBhbmQgYSByZXNvbHZlIGZ1bmN0aW9uXG4qL1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2YWJsZVByb21pc2UoKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICByZXNvbHZlciA9IHJlc29sdmU7XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0UHJvbWlzZSAobXMpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGxldCB0aWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgIH0sIG1zKTtcbiAgICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGlkKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByYW5kb21fc3RyaW5nKGxlbmd0aCkge1xuICAgIHZhciB0ZXh0ID0gXCJcIjtcbiAgICB2YXIgcG9zc2libGUgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpcIjtcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGV4dCArPSBwb3NzaWJsZS5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9zc2libGUubGVuZ3RoKSk7XG4gICAgfVxuICAgIHJldHVybiB0ZXh0O1xufSIsImltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuXG5jb25zdCBNQVhfUkVUUklFUyA9IDQ7XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdXJsID0gdXJsO1xuICAgICAgICB0aGlzLl93cztcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgfVxuXG4gICAgZ2V0IGNvbm5lY3RpbmcoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3Rpbmc7fVxuICAgIGdldCBjb25uZWN0ZWQoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3RlZDt9XG4gICAgZ2V0IHVybCgpIHtyZXR1cm4gdGhpcy5fdXJsO31cbiAgICBnZXQgb3B0aW9ucygpIHtyZXR1cm4gdGhpcy5fb3B0aW9uczt9XG5cbiAgICBjb25uZWN0KCkge1xuXG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RpbmcgfHwgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ29ubmVjdCB3aGlsZSBjb25uZWN0aW5nIG9yIGNvbm5lY3RlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIlRlcm1pbmF0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25uZWN0aW5nXG4gICAgICAgIHRoaXMuX3dzID0gbmV3IFdlYlNvY2tldCh0aGlzLl91cmwpO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gZSA9PiB0aGlzLl9vbl9vcGVuKGUpO1xuICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSBlID0+IHRoaXMub25fbWVzc2FnZShlLmRhdGEpO1xuICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gZSA9PiB0aGlzLl9vbl9jbG9zZShlKTtcbiAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IGUgPT4gdGhpcy5vbl9lcnJvcihlKTtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0aW5nKCk7XG4gICAgfVxuXG4gICAgX29uX29wZW4oZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAvLyByZWxlYXNlIGNvbm5lY3QgcHJvbWlzZXNcbiAgICAgICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICAgICAgLy8gcmVzZXQgcmV0cmllcyBvbiBzdWNjZXNzZnVsIGNvbm5lY3Rpb25cbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMub25fY29ubmVjdCgpO1xuICAgIH1cblxuICAgIF9vbl9jbG9zZShldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLm9uX2Rpc2Nvbm5lY3QoZXZlbnQpO1xuICAgICAgICB0aGlzLl9yZXRyaWVzICs9IDE7XG4gICAgICAgIGlmICghdGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICAgICAgICAgIH0sIDEwMDAgKiB0aGlzLl9yZXRyaWVzKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBfaXNfdGVybWluYXRlZCgpIHtcbiAgICAgICAgY29uc3Qge3JldHJpZXM9TUFYX1JFVFJJRVN9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKHRoaXMuX3JldHJpZXMgPj0gcmV0cmllcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFRlcm1pbmF0ZWQ6IE1heCByZXRyaWVzIHJlYWNoZWQgKCR7cmV0cmllc30pYCk7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cyA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBvbl9jb25uZWN0aW5nKCkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbm5lY3RpbmcgJHt0aGlzLnVybH1gKTt9XG4gICAgfVxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdChldmVudCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYFJlY2VpdmU6ICR7ZGF0YX1gKTt9XG4gICAgfVxuXG4gICAgc2VuZChkYXRhKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fd3Muc2VuZChkYXRhKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU2VuZCBmYWlsOiAke2Vycm9yfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbmQgZHJvcCA6IG5vdCBjb25uZWN0ZWRgKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29ubmVjdGVkUHJvbWlzZSgpIHtcbiAgICAgICAgY29uc3QgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMucHVzaChyZXNvbHZlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IHJhbmRvbV9zdHJpbmcgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmV4cG9ydCBjbGFzcyBDb2xsZWN0aW9uIHtcblxuICAgIGNvbnN0cnVjdG9yKHNzY2xpZW50LCBwYXRoLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gZmFsc2U7XG4gICAgICAgIC8vIHNoYXJlZHN0YXRlIGNsaWVudFxuICAgICAgICB0aGlzLl9zc2NsaWVudCA9IHNzY2xpZW50O1xuICAgICAgICB0aGlzLl9wYXRoID0gcGF0aDtcbiAgICAgICAgLy8gY2FsbGJhY2tzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgICAgIC8vIGl0ZW1zXG4gICAgICAgIHRoaXMuX21hcCA9IG5ldyBNYXAoKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNIQVJFRCBTVEFURSBDTElFTlQgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8qKlxuICAgICAqIENvbGxlY3Rpb24gcmVsZWFzZWQgYnkgc3MgY2xpZW50XG4gICAgICovXG5cbiAgICBfc3NjbGllbnRfdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gZW1wdHkgY29sbGVjdGlvbj9cbiAgICAgICAgLy8gZGlzY29ubmVjdCBmcm9tIG9ic2VydmVyc1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHNlcnZlciB1cGRhdGUgY29sbGVjdGlvbiBcbiAgICAgKi9cbiAgICBfc3NjbGllbnRfdXBkYXRlIChjaGFuZ2VzPXt9KSB7XG5cbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbGxlY3Rpb24gYWxyZWFkeSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7cmVtb3ZlLCBpbnNlcnQsIHJlc2V0PWZhbHNlfSA9IGNoYW5nZXM7XG4gICAgICAgIGNvbnN0IGRpZmZfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHJlbW92ZSBpdGVtcyAtIGNyZWF0ZSBkaWZmXG4gICAgICAgIGlmIChyZXNldCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHRoaXMuX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChcbiAgICAgICAgICAgICAgICAgICAgaXRlbS5pZCwgXG4gICAgICAgICAgICAgICAgICAgIHtpZDogaXRlbS5pZCwgbmV3OnVuZGVmaW5lZCwgb2xkOml0ZW19XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG5ldyBNYXAoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgX2lkIG9mIHJlbW92ZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG9sZCA9IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgICAgICBpZiAob2xkICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9tYXAuZGVsZXRlKF9pZCk7XG4gICAgICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChfaWQsIHtpZDpfaWQsIG5ldzp1bmRlZmluZWQsIG9sZH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGluc2VydCBpdGVtcyAtIHVwZGF0ZSBkaWZmXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpbnNlcnQpIHtcbiAgICAgICAgICAgIGNvbnN0IF9pZCA9IGl0ZW0uaWQ7XG4gICAgICAgICAgICAvLyBvbGQgZnJvbSBkaWZmX21hcCBvciBfbWFwXG4gICAgICAgICAgICBjb25zdCBkaWZmID0gZGlmZl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICBjb25zdCBvbGQgPSAoZGlmZiAhPSB1bmRlZmluZWQpID8gZGlmZi5vbGQgOiB0aGlzLl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICAvLyBzZXQgc3RhdGVcbiAgICAgICAgICAgIHRoaXMuX21hcC5zZXQoX2lkLCBpdGVtKTtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBkaWZmIG1hcFxuICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3Oml0ZW0sIG9sZH0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vdGlmeV9jYWxsYmFja3MoWy4uLmRpZmZfbWFwLnZhbHVlcygpXSk7XG4gICAgfVxuXG4gICAgX25vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUFBMSUNBVElPTiBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgZ2V0IHNpemUoKSB7cmV0dXJuIHRoaXMuX21hcC5zaXplfVxuICAgIGhhcyhpZCkge3JldHVybiB0aGlzLl9tYXAuaGFzKGlkKX1cbiAgICBnZXQoaWQpIHtcbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIFsuLi50aGlzLl9tYXAudmFsdWVzKCldXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLmdldChpZClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIGRpc3BhdGNoaW5nIHVwZGF0ZSB0byBzZXJ2ZXJcbiAgICAgKi9cbiAgICB1cGRhdGUgKGNoYW5nZXM9e30pIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbGxlY3Rpb24gYWxyZWFkeSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgLy8gZW5zdXJlIHRoYXQgaW5zZXJ0ZWQgaXRlbXMgaGF2ZSBpZHNcbiAgICAgICAgY29uc3Qge2luc2VydD1bXX0gPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzLmluc2VydCA9IGluc2VydC5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW0uaWQgPSBpdGVtLmlkIHx8IHJhbmRvbV9zdHJpbmcoMTApO1xuICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGhpcy5fc3NjbGllbnQudXBkYXRlKHRoaXMuX3BhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIHJlZ2lzdGVyIGNhbGxiYWNrXG4gICAgKi9cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTsgICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTsgICAgXG59IiwiXG4vKipcbiAqIFZhcmlhYmxlXG4gKiBcbiAqIFdyYXBwZXIgdG8gZXhwb3NlIGEgc2luZ2xlIGlkIChpdGVtKSBmcm9tIGEgY29sbGVjdGlvbiBhcyBhIHN0YW5kYWxvbmUgdmFyaWFibGVcbiAqIFxuICogLSBpZiB0aGVyZSBpcyBubyBpdGVtIHdpdGggaWQgaW4gY29sbGVjdGlvbiAtIHRoZSB2YXJpYWJsZSB3aWxsIGJlIHVuZGVmaW5lZFxuICogICBvciBoYXZlIGEgZGVmYXVsdCB2YWx1ZVxuICogLSBvdGhlcndpc2UsIHRoZSB2YXJpYWJsZSB3aWxsIGJlIHRoZSB2YWx1ZSBvZiBpdGVtLmRhdGFcbiAqIFxuICogIERlZmF1bHQgdmFsdWUgaXMgZ2l2ZW4gaW4gb3B0aW9ucyB7dmFsdWU6fVxuICovXG5cbmV4cG9ydCBjbGFzcyBWYXJpYWJsZSB7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb2xsLCBpZCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl90ZXJtaW5pYXRlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb2xsID0gY29sbDtcbiAgICAgICAgdGhpcy5faWQgPSBpZDtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIC8vIGNhbGxiYWNrXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIF9vbmNoYW5nZShkaWZmcykge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidmFyaWFibGUgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZGlmZiBvZiBkaWZmcykge1xuICAgICAgICAgICAgaWYgKGRpZmYuaWQgPT0gdGhpcy5faWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeV9jYWxsYmFja3MoZGlmZik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXI6IGhhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcbiAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9O1xuICAgIFxuICAgIG5vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgXG4gICAgc2V0ICh2YWx1ZSkge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidmFyaWJsZSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgaXRlbXMgPSBbe2lkOnRoaXMuX2lkLCBkYXRhOnZhbHVlfV07XG4gICAgICAgIHJldHVybiB0aGlzLl9jb2xsLnVwZGF0ZSh7aW5zZXJ0Oml0ZW1zLCByZXNldDpmYWxzZX0pO1xuICAgIH1cblxuICAgIGdldCAoKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb2xsLmhhcyh0aGlzLl9pZCkpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9jb2xsLmdldCh0aGlzLl9pZCkuZGF0YTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9vcHRpb25zLnZhbHVlO1xuICAgICAgICB9XG4gICAgfVxuICAgIFxuICAgIHNzX2NsaWVudF90ZXJtaW5hdGUoKSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSB0cnVlO1xuICAgICAgICB0aGlzLl9jb2xsLnJlbW92ZV9jYWxsYmFjayh0aGlzLl9oYW5kbGUpO1xuICAgIH1cbn0iLCIvLyB3ZWJwYWdlIGNsb2NrIC0gcGVyZm9ybWFuY2Ugbm93IC0gc2Vjb25kc1xuY29uc3QgbG9jYWwgPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHBlcmZvcm1hbmNlLm5vdygpLzEwMDAuMDtcbiAgICB9XG59XG4vLyBzeXN0ZW0gY2xvY2sgLSBlcG9jaCAtIHNlY29uZHNcbmNvbnN0IGVwb2NoID0ge1xuICAgIG5vdzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuZXcgRGF0ZSgpLzEwMDAuMDtcbiAgICB9XG59XG5cbi8qKlxuICogQ0xPQ0sgZ2l2ZXMgZXBvY2ggdmFsdWVzLCBidXQgaXMgaW1wbGVtZW50ZWRcbiAqIHVzaW5nIHBlcmZvcm1hbmNlIG5vdyBmb3IgYmV0dGVyXG4gKiB0aW1lIHJlc29sdXRpb24gYW5kIHByb3RlY3Rpb24gYWdhaW5zdCBzeXN0ZW0gXG4gKiB0aW1lIGFkanVzdG1lbnRzLlxuICovXG5cbmNvbnN0IENMT0NLID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbnN0IHQwX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgY29uc3QgdDBfZXBvY2ggPSBlcG9jaC5ub3coKTtcbiAgICByZXR1cm4ge1xuICAgICAgICBub3c6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGNvbnN0IHQxX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgICAgICAgICByZXR1cm4gdDBfZXBvY2ggKyAodDFfbG9jYWwgLSB0MF9sb2NhbCk7XG4gICAgICAgIH1cbiAgICB9O1xufSgpO1xuXG5cbi8qKlxuICogRXN0aW1hdGUgdGhlIGNsb2NrIG9mIHRoZSBzZXJ2ZXIgXG4gKi9cblxuY29uc3QgTUFYX1NBTVBMRV9DT1VOVCA9IDMwO1xuXG5leHBvcnQgY2xhc3MgU2VydmVyQ2xvY2sge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQpIHtcbiAgICAgICAgLy8gc2hhcmVzdGF0ZSBjbGllbnRcbiAgICAgICAgdGhpcy5fc3NjbGllbnQgPSBzc2NsaWVudDtcbiAgICAgICAgLy8gcGluZ2VyXG4gICAgICAgIHRoaXMuX3BpbmdlciA9IG5ldyBQaW5nZXIodGhpcy5fb25waW5nLmJpbmQodGhpcykpO1xuICAgICAgICAvLyBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMgPSBbXTtcbiAgICAgICAgLy8gZXN0aW1hdGVzXG4gICAgICAgIHRoaXMuX3RyYW5zID0gMTAwMC4wO1xuICAgICAgICB0aGlzLl9za2V3ID0gMC4wO1xuICAgIH1cblxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgdGhpcy5fcGluZ2VyLnJlc3VtZSgpO1xuICAgIH1cblxuICAgIHBhdXNlKCkge1xuICAgICAgICB0aGlzLl9waW5nZXIucGF1c2UoKTtcbiAgICB9XG5cbiAgICBfb25waW5nKCkge1xuICAgICAgICBjb25zdCB0czAgPSBDTE9DSy5ub3coKTtcbiAgICAgICAgdGhpcy5fc3NjbGllbnQuZ2V0KFwiL2Nsb2NrXCIpLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIGlmIChvaykge1xuICAgICAgICAgICAgICAgIGNvbnN0IHRzMSA9IENMT0NLLm5vdygpO1xuICAgICAgICAgICAgICAgIHRoaXMuX2FkZF9zYW1wbGUodHMwLCBkYXRhLCB0czEpOyAgICBcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX2FkZF9zYW1wbGUoY3MsIHNzLCBjcikge1xuICAgICAgICBsZXQgdHJhbnMgPSAoY3IgLSBjcykgLyAyLjA7XG4gICAgICAgIGxldCBza2V3ID0gc3MgLSAoY3IgKyBjcykgLyAyLjA7XG4gICAgICAgIGxldCBzYW1wbGUgPSBbY3MsIHNzLCBjciwgdHJhbnMsIHNrZXddO1xuICAgICAgICAvLyBhZGQgdG8gc2FtcGxlc1xuICAgICAgICB0aGlzLl9zYW1wbGVzLnB1c2goc2FtcGxlKVxuICAgICAgICBpZiAodGhpcy5fc2FtcGxlcy5sZW5ndGggPiBNQVhfU0FNUExFX0NPVU5UKSB7XG4gICAgICAgICAgICAvLyByZW1vdmUgZmlyc3Qgc2FtcGxlXG4gICAgICAgICAgICB0aGlzLl9zYW1wbGVzLnNoaWZ0KCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gcmVldmFsdWF0ZSBlc3RpbWF0ZXMgZm9yIHNrZXcgYW5kIHRyYW5zXG4gICAgICAgIHRyYW5zID0gMTAwMDAwLjA7XG4gICAgICAgIHNrZXcgPSAwLjA7XG4gICAgICAgIGZvciAoY29uc3Qgc2FtcGxlIG9mIHRoaXMuX3NhbXBsZXMpIHtcbiAgICAgICAgICAgIGlmIChzYW1wbGVbM10gPCB0cmFucykge1xuICAgICAgICAgICAgICAgIHRyYW5zID0gc2FtcGxlWzNdO1xuICAgICAgICAgICAgICAgIHNrZXcgPSBzYW1wbGVbNF07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fc2tldyA9IHNrZXc7XG4gICAgICAgIHRoaXMuX3RyYW5zID0gdHJhbnM7XG4gICAgfVxuXG4gICAgZ2V0IHNrZXcoKSB7cmV0dXJuIHRoaXMuX3NrZXc7fVxuICAgIGdldCB0cmFucygpIHtyZXR1cm4gdGhpcy5fdHJhbnM7fVxuXG4gICAgbm93KCkge1xuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2sgaXMgbG9jYWwgY2xvY2sgKyBlc3RpbWF0ZWQgc2tld1xuICAgICAgICByZXR1cm4gQ0xPQ0subm93KCkgKyB0aGlzLl9za2V3O1xuICAgIH1cblxufVxuXG5cbi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICBQSU5HRVJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbi8qKlxuICogUGluZ2VyIGludm9rZXMgYSBjYWxsYmFjayByZXBlYXRlZGx5LCBpbmRlZmluaXRlbHkuIFxuICogUGluZ2luZyBpbiAzIHN0YWdlcywgZmlyc3QgZnJlcXVlbnRseSwgdGhlbiBtb2RlcmF0ZWx5LCBcbiAqIHRoZW4gc2xvd2x5LlxuICovXG5cbmNvbnN0IFNNQUxMX0RFTEFZID0gMjA7IC8vIG1zXG5jb25zdCBNRURJVU1fREVMQVkgPSA1MDA7IC8vIG1zXG5jb25zdCBMQVJHRV9ERUxBWSA9IDEwMDAwOyAvLyBtc1xuXG5jb25zdCBERUxBWV9TRVFVRU5DRSA9IFtcbiAgICAuLi5uZXcgQXJyYXkoMykuZmlsbChTTUFMTF9ERUxBWSksIFxuICAgIC4uLm5ldyBBcnJheSg3KS5maWxsKE1FRElVTV9ERUxBWSksXG4gICAgLi4uW0xBUkdFX0RFTEFZXVxuXTtcblxuY2xhc3MgUGluZ2VyIHtcblxuICAgIGNvbnN0cnVjdG9yIChjYWxsYmFjaykge1xuICAgICAgICB0aGlzLl9jb3VudCA9IDA7XG4gICAgICAgIHRoaXMuX3RpZCA9IHVuZGVmaW5lZDtcbiAgICAgICAgdGhpcy5fY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgICAgICAgdGhpcy5fcGluZyA9IHRoaXMucGluZy5iaW5kKHRoaXMpO1xuICAgICAgICB0aGlzLl9kZWxheXMgPSBbLi4uREVMQVlfU0VRVUVOQ0VdO1xuICAgIH1cbiAgICBwYXVzZSgpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgfVxuICAgIHJlc3VtZSgpIHtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgICAgIHRoaXMucGluZygpO1xuICAgIH1cbiAgICByZXN0YXJ0KCkge1xuICAgICAgICB0aGlzLl9kZWxheXMgPSBbLi4uREVMQVlfU0VRVUVOQ0VdO1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHBpbmcgKCkge1xuICAgICAgICBsZXQgbmV4dF9kZWxheSA9IHRoaXMuX2RlbGF5c1swXTtcbiAgICAgICAgaWYgKHRoaXMuX2RlbGF5cy5sZW5ndGggPiAxKSB7XG4gICAgICAgICAgICB0aGlzLl9kZWxheXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5fY2FsbGJhY2spIHtcbiAgICAgICAgICAgIHRoaXMuX2NhbGxiYWNrKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fdGlkID0gc2V0VGltZW91dCh0aGlzLl9waW5nLCBuZXh0X2RlbGF5KTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgV2ViU29ja2V0SU8gfSBmcm9tIFwiLi93c2lvLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IENvbGxlY3Rpb24gfSBmcm9tIFwiLi9jb2xsZWN0aW9uLmpzXCI7XG5pbXBvcnQgeyBWYXJpYWJsZSB9IGZyb20gXCIuL3ZhcmlhYmxlLmpzXCI7XG5pbXBvcnQgeyBTZXJ2ZXJDbG9jayB9IGZyb20gXCIuL3NlcnZlcmNsb2NrLmpzXCI7XG5cbmNvbnN0IE1zZ1R5cGUgPSBPYmplY3QuZnJlZXplKHtcbiAgICBNRVNTQUdFIDogXCJNRVNTQUdFXCIsXG4gICAgUkVRVUVTVDogXCJSRVFVRVNUXCIsXG4gICAgUkVQTFk6IFwiUkVQTFlcIlxuIH0pO1xuIFxuY29uc3QgTXNnQ21kID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgR0VUIDogXCJHRVRcIixcbiAgICBQVVQ6IFwiUFVUXCIsXG4gICAgTk9USUZZOiBcIk5PVElGWVwiXG59KTtcblxuXG5leHBvcnQgY2xhc3MgU2hhcmVkU3RhdGVDbGllbnQgZXh0ZW5kcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3RvciAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKHVybCwgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gcmVxdWVzdHNcbiAgICAgICAgdGhpcy5fcmVxaWQgPSAwO1xuICAgICAgICB0aGlzLl9wZW5kaW5nID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgLy8gcGF0aCAtPiB7fSBcbiAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gY29sbGVjdGlvbnMge3BhdGggLT4gY29sbGVjdGlvbn1cbiAgICAgICAgdGhpcy5fY29sbF9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gdmFyaWFibGVzIHtbcGF0aCwgaWRdIC0+IHZhcmlhYmxlfVxuICAgICAgICB0aGlzLl92YXJfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2s7XG5cbiAgICAgICAgdGhpcy5jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBDT05ORUNUSU9OIFxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgICAgICAvLyByZWZyZXNoIGxvY2FsIHN1c2NyaXB0aW9uc1xuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuc2l6ZSA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnRoaXMuX3N1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfVxuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2tcbiAgICAgICAgaWYgKHRoaXMuX3NlcnZlcl9jbG9jayAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jay5yZXN1bWUoKTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgICAgIC8vIHNlcnZlciBjbG9ja1xuICAgICAgICBpZiAodGhpcy5fc2VydmVyX2Nsb2NrICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrLnBhdXNlKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZXJyb3IoZXJyb3IpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBDb21tdW5pY2F0aW9uIEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEhBTkRMRVJTXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGxldCBtc2cgPSBKU09OLnBhcnNlKGRhdGEpO1xuICAgICAgICBpZiAobXNnLnR5cGUgPT0gTXNnVHlwZS5SRVBMWSkge1xuICAgICAgICAgICAgbGV0IHJlcWlkID0gbXNnLnR1bm5lbDtcbiAgICAgICAgICAgIGlmICh0aGlzLl9wZW5kaW5nLmhhcyhyZXFpZCkpIHtcbiAgICAgICAgICAgICAgICBsZXQgcmVzb2x2ZXIgPSB0aGlzLl9wZW5kaW5nLmdldChyZXFpZCk7XG4gICAgICAgICAgICAgICAgdGhpcy5fcGVuZGluZy5kZWxldGUocmVxaWQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IHtvaywgZGF0YX0gPSBtc2c7XG4gICAgICAgICAgICAgICAgcmVzb2x2ZXIoe29rLCBkYXRhfSk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAobXNnLnR5cGUgPT0gTXNnVHlwZS5NRVNTQUdFKSB7XG4gICAgICAgICAgICBpZiAobXNnLmNtZCA9PSBNc2dDbWQuTk9USUZZKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5faGFuZGxlX25vdGlmeShtc2cpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgX2hhbmRsZV9ub3RpZnkobXNnKSB7XG4gICAgICAgIC8vIHVwZGF0ZSBjb2xsZWN0aW9uIHN0YXRlXG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fY29sbF9tYXAuZ2V0KG1zZ1tcInBhdGhcIl0pO1xuICAgICAgICBpZiAoZHMgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkcy5fc3NjbGllbnRfdXBkYXRlKG1zZ1tcImRhdGFcIl0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBTRVJWRVIgUkVRVUVTVFNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBfcmVxdWVzdChjbWQsIHBhdGgsIGFyZykge1xuICAgICAgICBjb25zdCByZXFpZCA9IHRoaXMuX3JlcWlkKys7XG4gICAgICAgIGNvbnN0IG1zZyA9IHtcbiAgICAgICAgICAgIHR5cGU6IE1zZ1R5cGUuUkVRVUVTVCxcbiAgICAgICAgICAgIGNtZCwgXG4gICAgICAgICAgICBwYXRoLCBcbiAgICAgICAgICAgIGFyZyxcbiAgICAgICAgICAgIHR1bm5lbDogcmVxaWRcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5zZW5kKEpTT04uc3RyaW5naWZ5KG1zZykpO1xuICAgICAgICBsZXQgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcuc2V0KHJlcWlkLCByZXNvbHZlcik7XG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIC8vIHNwZWNpYWwgaGFuZGxpbmcgZm9yIHJlcGxpZXMgdG8gUFVUIC9zdWJzXG4gICAgICAgICAgICBpZiAoY21kID09IE1zZ0NtZC5QVVQgJiYgcGF0aCA9PSBcIi9zdWJzXCIgJiYgb2spIHtcbiAgICAgICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3Vic2NyaXB0aW9uIHN0YXRlXG4gICAgICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKGRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge29rLCBwYXRoLCBkYXRhfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3N1YiAocGF0aCkge1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgICAgICAvLyBzZXQgbmV3IHBhdGhcbiAgICAgICAgICAgIHN1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzIC0gc3Vic2NyaWJlIG9uIHJlY29ubmVjdFxuICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe29rOiB0cnVlLCBwYXRoLCBkYXRhOnVuZGVmaW5lZH0pXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIF91bnN1YiAocGF0aCkge1xuICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgIC8vIHJlbW92ZSBwYXRoXG4gICAgICAgIHN1YnNfbWFwLmRlbGV0ZShwYXRoKVxuICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi5zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICAvLyBhY2NzZXNzb3IgZm9yIHNlcnZlciBjbG9ja1xuICAgIGdldCBjbG9jaygpIHtcbiAgICAgICAgaWYgKHRoaXMuX3NlcnZlcl9jbG9jayA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jayA9IG5ldyBTZXJ2ZXJDbG9jayh0aGlzKTtcbiAgICAgICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jay5yZXN1bWUoKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdGhpcy5fc2VydmVyX2Nsb2NrO1xuICAgIH1cblxuICAgIC8vIGdldCByZXF1ZXN0IGZvciBpdGVtcyBieSBwYXRoXG4gICAgZ2V0KHBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLkdFVCwgcGF0aCk7XG4gICAgfVxuICAgIFxuICAgIC8vIHVwZGF0ZSByZXF1ZXN0IGZvciBwYXRoXG4gICAgdXBkYXRlKHBhdGgsIGNoYW5nZXMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLlBVVCwgcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYWNxdWlyZSBjb2xsZWN0aW9uIGZvciBwYXRoXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHN1YnNjcmliZXMgdG8gcGF0aCBpZiBuZWVkZWRcbiAgICAgKi9cbiAgICBhY3F1aXJlX2NvbGxlY3Rpb24gKHBhdGgsIG9wdGlvbnMpIHtcbiAgICAgICAgcGF0aCA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoIDogXCIvXCIgKyBwYXRoO1xuICAgICAgICAvLyBzdWJzY3JpYmUgaWYgc3Vic2NyaXB0aW9uIGRvZXMgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgLy8gc3Vic2NyaWJlIHRvIHBhdGhcbiAgICAgICAgICAgIHRoaXMuX3N1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgY29sbGVjdGlvbiBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fY29sbF9tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl9jb2xsX21hcC5zZXQocGF0aCwgbmV3IENvbGxlY3Rpb24odGhpcywgcGF0aCwgb3B0aW9ucykpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9jb2xsX21hcC5nZXQocGF0aCk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYWNxdWlyZSB2YXJpYWJsZSBmb3IgKHBhdGgsIG5hbWUpXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IGFjcXVpcmUgY29sbGVjdGlvblxuICAgICAqL1xuICAgIGFjcXVpcmVfdmFyaWFibGUgKHBhdGgsIG5hbWUsIG9wdGlvbnMpIHtcbiAgICAgICAgcGF0aCA9IHBhdGguc3RhcnRzV2l0aChcIi9cIikgPyBwYXRoIDogXCIvXCIgKyBwYXRoO1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuYWNxdWlyZV9jb2xsZWN0aW9uKHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgdmFyaWFibGUgaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX3Zhcl9tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl92YXJfbWFwLnNldChwYXRoLCBuZXcgTWFwKCkpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhcl9tYXAgPSB0aGlzLl92YXJfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKCF2YXJfbWFwLmdldChuYW1lKSkge1xuICAgICAgICAgICAgdmFyX21hcC5zZXQobmFtZSwgbmV3IFZhcmlhYmxlKGRzLCBuYW1lLCBvcHRpb25zKSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdmFyX21hcC5nZXQobmFtZSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiByZWxlYXNlIHBhdGgsIGluY2x1ZGluZyBjb2xsZWN0aW9uIGFuZCB2YXJpYWJsZXNcbiAgICAgKi9cbiAgICByZWxlYXNlKHBhdGgpIHtcbiAgICAgICAgLy8gdW5zdWJzY3JpYmVcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fdW5zdWIocGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gdGVybWluYXRlIGNvbGxlY3Rpb24gYW5kIHZhcmlhYmxlc1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICAgICAgZHMuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICBjb25zdCB2YXJfbWFwID0gdGhpcy5fdmFyX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmICh2YXJfbWFwICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCB2IG9mIHZhcl9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgICAgICB2Ll9zc2NsaWVudF90ZXJtaW5hdGUoKTtcbiAgICAgICAgICAgIH0gICAgXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29sbF9tYXAuZGVsZXRlKHBhdGgpO1xuICAgICAgICB0aGlzLl92YXJfbWFwLmRlbGV0ZShwYXRoKTtcbiAgICB9XG59XG5cblxuIiwiLypcbiAgICBDb2xsZWN0aW9uIFZpZXdlclxuKi9cblxuZnVuY3Rpb24gaXRlbTJzdHJpbmcoaXRlbSkge1xuICAgIGNvbnN0IHtpZCwgaXR2LCBkYXRhfSA9IGl0ZW07XG4gICAgbGV0IGRhdGFfdHh0ID0gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgbGV0IGl0dl90eHQgPSAoaXR2ICE9IHVuZGVmaW5lZCkgPyBKU09OLnN0cmluZ2lmeShpdHYpIDogXCJcIjtcbiAgICBsZXQgaWRfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImlkXCI+JHtpZH08L3NwYW4+YDtcbiAgICBsZXQgaXR2X2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpdHZcIj4ke2l0dl90eHR9PC9zcGFuPmA7XG4gICAgbGV0IGRhdGFfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImRhdGFcIj4ke2RhdGFfdHh0fTwvc3Bhbj5gO1xuICAgIHJldHVybiBgXG4gICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8YnV0dG9uIGlkPVwiZGVsZXRlXCI+WDwvYnV0dG9uPlxuICAgICAgICAgICAgJHtpZF9odG1sfTogJHtpdHZfaHRtbH0gJHtkYXRhX2h0bWx9XG4gICAgICAgIDwvZGl2PmA7XG59XG5cblxuZXhwb3J0IGNsYXNzIENvbGxlY3Rpb25WaWV3ZXIge1xuXG4gICAgY29uc3RydWN0b3IoY29sbGVjdGlvbiwgZWxlbSwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl9jb2xsID0gY29sbGVjdGlvbjtcbiAgICAgICAgdGhpcy5fZWxlbSA9IGVsZW07XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpOyBcblxuICAgICAgICAvLyBvcHRpb25zXG4gICAgICAgIGxldCBkZWZhdWx0cyA9IHtcbiAgICAgICAgICAgIGRlbGV0ZTpmYWxzZSxcbiAgICAgICAgICAgIHRvU3RyaW5nOml0ZW0yc3RyaW5nXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSB7Li4uZGVmYXVsdHMsIC4uLm9wdGlvbnN9O1xuXG4gICAgICAgIC8qXG4gICAgICAgICAgICBTdXBwb3J0IGRlbGV0ZVxuICAgICAgICAqL1xuICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5kZWxldGUpIHtcbiAgICAgICAgICAgIC8vIGxpc3RlbiBmb3IgY2xpY2sgZXZlbnRzIG9uIHJvb3QgZWxlbWVudFxuICAgICAgICAgICAgZWxlbS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYXRjaCBjbGljayBldmVudCBmcm9tIGRlbGV0ZSBidXR0b25cbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVCdG4gPSBlLnRhcmdldC5jbG9zZXN0KFwiI2RlbGV0ZVwiKTtcbiAgICAgICAgICAgICAgICBpZiAoZGVsZXRlQnRuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpc3RJdGVtID0gZGVsZXRlQnRuLmNsb3Nlc3QoXCIubGlzdC1pdGVtXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobGlzdEl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2NvbGwudXBkYXRlKHtyZW1vdmU6W2xpc3RJdGVtLmlkXX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIHJlbmRlciBpbml0aWFsIHN0YXRlXG4gICAgICAgICovIFxuICAgICAgICBjb25zdCBkaWZmcyA9IHRoaXMuX2NvbGwuZ2V0KClcbiAgICAgICAgICAgIC5tYXAoaXRlbSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtpZDppdGVtLmlkLCBuZXc6aXRlbX1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB0aGlzLl9vbmNoYW5nZShkaWZmcyk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGNvbnN0IHt0b1N0cmluZ30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBmb3IgKGxldCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5uZXcpIHtcbiAgICAgICAgICAgICAgICAvLyBhZGRcbiAgICAgICAgICAgICAgICBsZXQgbm9kZSA9IHRoaXMuX2VsZW0ucXVlcnlTZWxlY3RvcihgIyR7ZGlmZi5pZH1gKTtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZShcImlkXCIsIGRpZmYuaWQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNsYXNzTGlzdC5hZGQoXCJsaXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VsZW0uYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5vZGUuaW5uZXJIVE1MID0gdG9TdHJpbmcoZGlmZi5uZXcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkaWZmLm9sZCkge1xuICAgICAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0lBQUE7SUFDQTtJQUNBO0lBQ0E7SUFDQTs7SUFFTyxTQUFTLGlCQUFpQixHQUFHO0lBQ3BDLElBQUksSUFBSSxRQUFRO0lBQ2hCLElBQUksSUFBSSxPQUFPLEdBQUcsSUFBSSxP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
