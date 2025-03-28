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
                    this._item = diff.new;
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NsaWVudC91dGlsLmpzIiwiLi4vLi4vc3JjL2NsaWVudC93c2lvLmpzIiwiLi4vLi4vc3JjL2NsaWVudC9jb2xsZWN0aW9uLmpzIiwiLi4vLi4vc3JjL2NsaWVudC92YXJpYWJsZS5qcyIsIi4uLy4uL3NyYy9jbGllbnQvc2VydmVyY2xvY2suanMiLCIuLi8uLi9zcmMvY2xpZW50L3NzX2NsaWVudC5qcyIsIi4uLy4uL3NyYy9jbGllbnQvdmlld2VyLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qXG4gICAgQ3JlYXRlIGEgcHJvbWlzZSB3aGljaCBjYW4gYmUgcmVzb2x2ZWRcbiAgICBwcm9ncmFtbWF0aWNhbGx5IGJ5IGV4dGVybmFsIGNvZGUuXG4gICAgUmV0dXJuIGEgcHJvbWlzZSBhbmQgYSByZXNvbHZlIGZ1bmN0aW9uXG4qL1xuXG5leHBvcnQgZnVuY3Rpb24gcmVzb2x2YWJsZVByb21pc2UoKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICByZXNvbHZlciA9IHJlc29sdmU7XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cbmV4cG9ydCBmdW5jdGlvbiB0aW1lb3V0UHJvbWlzZSAobXMpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIGxldCB0aWQgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgIHJlc29sdmUodHJ1ZSk7XG4gICAgICAgIH0sIG1zKTtcbiAgICAgICAgcmVzb2x2ZXIgPSAoKSA9PiB7XG4gICAgICAgICAgICBpZiAodGlkKSB7XG4gICAgICAgICAgICAgICAgY2xlYXJUaW1lb3V0KHRpZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcbiAgICAgICAgfVxuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5cbmV4cG9ydCBmdW5jdGlvbiByYW5kb21fc3RyaW5nKGxlbmd0aCkge1xuICAgIHZhciB0ZXh0ID0gXCJcIjtcbiAgICB2YXIgcG9zc2libGUgPSBcIkFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFlaYWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpcIjtcbiAgICBmb3IodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdGV4dCArPSBwb3NzaWJsZS5jaGFyQXQoTWF0aC5mbG9vcihNYXRoLnJhbmRvbSgpICogcG9zc2libGUubGVuZ3RoKSk7XG4gICAgfVxuICAgIHJldHVybiB0ZXh0O1xufSIsImltcG9ydCB7IHJlc29sdmFibGVQcm9taXNlIH0gZnJvbSBcIi4vdXRpbC5qc1wiO1xuXG5jb25zdCBNQVhfUkVUUklFUyA9IDQ7XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3Rvcih1cmwsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fdXJsID0gdXJsO1xuICAgICAgICB0aGlzLl93cztcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgfVxuXG4gICAgZ2V0IGNvbm5lY3RpbmcoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3Rpbmc7fVxuICAgIGdldCBjb25uZWN0ZWQoKSB7cmV0dXJuIHRoaXMuX2Nvbm5lY3RlZDt9XG4gICAgZ2V0IHVybCgpIHtyZXR1cm4gdGhpcy5fdXJsO31cbiAgICBnZXQgb3B0aW9ucygpIHtyZXR1cm4gdGhpcy5fb3B0aW9uczt9XG5cbiAgICBjb25uZWN0KCkge1xuXG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RpbmcgfHwgdGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiQ29ubmVjdCB3aGlsZSBjb25uZWN0aW5nIG9yIGNvbm5lY3RlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBpZiAodGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIlRlcm1pbmF0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBjb25uZWN0aW5nXG4gICAgICAgIHRoaXMuX3dzID0gbmV3IFdlYlNvY2tldCh0aGlzLl91cmwpO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gZSA9PiB0aGlzLl9vbl9vcGVuKGUpO1xuICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSBlID0+IHRoaXMub25fbWVzc2FnZShlLmRhdGEpO1xuICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gZSA9PiB0aGlzLl9vbl9jbG9zZShlKTtcbiAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IGUgPT4gdGhpcy5vbl9lcnJvcihlKTtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0aW5nKCk7XG4gICAgfVxuXG4gICAgX29uX29wZW4oZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAvLyByZWxlYXNlIGNvbm5lY3QgcHJvbWlzZXNcbiAgICAgICAgZm9yIChjb25zdCByZXNvbHZlciBvZiB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICAgICAgLy8gcmVzZXQgcmV0cmllcyBvbiBzdWNjZXNzZnVsIGNvbm5lY3Rpb25cbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMub25fY29ubmVjdCgpO1xuICAgIH1cblxuICAgIF9vbl9jbG9zZShldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLm9uX2Rpc2Nvbm5lY3QoZXZlbnQpO1xuICAgICAgICB0aGlzLl9yZXRyaWVzICs9IDE7XG4gICAgICAgIGlmICghdGhpcy5faXNfdGVybWluYXRlZCgpKSB7XG4gICAgICAgICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgICAgICAgICB0aGlzLmNvbm5lY3QoKTtcbiAgICAgICAgICAgIH0sIDEwMDAgKiB0aGlzLl9yZXRyaWVzKTtcbiAgICAgICAgfTtcbiAgICB9XG5cbiAgICBfaXNfdGVybWluYXRlZCgpIHtcbiAgICAgICAgY29uc3Qge3JldHJpZXM9TUFYX1JFVFJJRVN9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKHRoaXMuX3JldHJpZXMgPj0gcmV0cmllcykge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFRlcm1pbmF0ZWQ6IE1heCByZXRyaWVzIHJlYWNoZWQgKCR7cmV0cmllc30pYCk7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSB0cnVlO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25vcGVuID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cyA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBvbl9jb25uZWN0aW5nKCkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbm5lY3RpbmcgJHt0aGlzLnVybH1gKTt9XG4gICAgfVxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYEVycm9yOiAke2Vycm9yfWApO31cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdChldmVudCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYFJlY2VpdmU6ICR7ZGF0YX1gKTt9XG4gICAgfVxuXG4gICAgc2VuZChkYXRhKSB7XG4gICAgICAgIGlmICh0aGlzLl9jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fd3Muc2VuZChkYXRhKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgU2VuZCBmYWlsOiAke2Vycm9yfWApO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgY29uc29sZS5sb2coYFNlbmQgZHJvcCA6IG5vdCBjb25uZWN0ZWRgKVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgY29ubmVjdGVkUHJvbWlzZSgpIHtcbiAgICAgICAgY29uc3QgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMucHVzaChyZXNvbHZlcik7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHByb21pc2U7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IHJhbmRvbV9zdHJpbmcgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmV4cG9ydCBjbGFzcyBDb2xsZWN0aW9uIHtcblxuICAgIGNvbnN0cnVjdG9yKHNzY2xpZW50LCBwYXRoLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gZmFsc2U7XG4gICAgICAgIC8vIHNoYXJlZHN0YXRlIGNsaWVudFxuICAgICAgICB0aGlzLl9zc2NsaWVudCA9IHNzY2xpZW50O1xuICAgICAgICB0aGlzLl9wYXRoID0gcGF0aDtcbiAgICAgICAgLy8gY2FsbGJhY2tzXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgICAgIC8vIGl0ZW1zXG4gICAgICAgIHRoaXMuX21hcCA9IG5ldyBNYXAoKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNIQVJFRCBTVEFURSBDTElFTlQgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8qKlxuICAgICAqIENvbGxlY3Rpb24gcmVsZWFzZWQgYnkgc3MgY2xpZW50XG4gICAgICovXG5cbiAgICBfc3NjbGllbnRfdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gZW1wdHkgY29sbGVjdGlvbj9cbiAgICAgICAgLy8gZGlzY29ubmVjdCBmcm9tIG9ic2VydmVyc1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHNlcnZlciB1cGRhdGUgY29sbGVjdGlvbiBcbiAgICAgKi9cbiAgICBfc3NjbGllbnRfdXBkYXRlIChjaGFuZ2VzPXt9KSB7XG5cbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbGxlY3Rpb24gYWxyZWFkeSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCB7cmVtb3ZlLCBpbnNlcnQsIHJlc2V0PWZhbHNlfSA9IGNoYW5nZXM7XG4gICAgICAgIGNvbnN0IGRpZmZfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHJlbW92ZSBpdGVtcyAtIGNyZWF0ZSBkaWZmXG4gICAgICAgIGlmIChyZXNldCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHRoaXMuX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChcbiAgICAgICAgICAgICAgICAgICAgaXRlbS5pZCwgXG4gICAgICAgICAgICAgICAgICAgIHtpZDogaXRlbS5pZCwgbmV3OnVuZGVmaW5lZCwgb2xkOml0ZW19XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG5ldyBNYXAoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgX2lkIG9mIHJlbW92ZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG9sZCA9IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgICAgICBpZiAob2xkICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9tYXAuZGVsZXRlKF9pZCk7XG4gICAgICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChfaWQsIHtpZDpfaWQsIG5ldzp1bmRlZmluZWQsIG9sZH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGluc2VydCBpdGVtcyAtIHVwZGF0ZSBkaWZmXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpbnNlcnQpIHtcbiAgICAgICAgICAgIGNvbnN0IF9pZCA9IGl0ZW0uaWQ7XG4gICAgICAgICAgICAvLyBvbGQgZnJvbSBkaWZmX21hcCBvciBfbWFwXG4gICAgICAgICAgICBjb25zdCBkaWZmID0gZGlmZl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICBjb25zdCBvbGQgPSAoZGlmZiAhPSB1bmRlZmluZWQpID8gZGlmZi5vbGQgOiB0aGlzLl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICAvLyBzZXQgc3RhdGVcbiAgICAgICAgICAgIHRoaXMuX21hcC5zZXQoX2lkLCBpdGVtKTtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBkaWZmIG1hcFxuICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3Oml0ZW0sIG9sZH0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vdGlmeV9jYWxsYmFja3MoWy4uLmRpZmZfbWFwLnZhbHVlcygpXSk7XG4gICAgfVxuXG4gICAgX25vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUFBMSUNBVElPTiBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgZ2V0IHNpemUoKSB7cmV0dXJuIHRoaXMuX21hcC5zaXplfVxuICAgIGhhcyhpZCkge3JldHVybiB0aGlzLl9tYXAuaGFzKGlkKX1cbiAgICBnZXQoaWQpIHtcbiAgICAgICAgaWYgKGlkID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuIFsuLi50aGlzLl9tYXAudmFsdWVzKCldXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fbWFwLmdldChpZClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIGRpc3BhdGNoaW5nIHVwZGF0ZSB0byBzZXJ2ZXJcbiAgICAgKi9cbiAgICB1cGRhdGUgKGNoYW5nZXM9e30pIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcImNvbGxlY3Rpb24gYWxyZWFkeSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgLy8gZW5zdXJlIHRoYXQgaW5zZXJ0ZWQgaXRlbXMgaGF2ZSBpZHNcbiAgICAgICAgY29uc3Qge2luc2VydD1bXX0gPSBjaGFuZ2VzO1xuICAgICAgICBjaGFuZ2VzLmluc2VydCA9IGluc2VydC5tYXAoKGl0ZW0pID0+IHtcbiAgICAgICAgICAgIGl0ZW0uaWQgPSBpdGVtLmlkIHx8IHJhbmRvbV9zdHJpbmcoMTApO1xuICAgICAgICAgICAgcmV0dXJuIGl0ZW07XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm4gdGhpcy5fc3NjbGllbnQudXBkYXRlKHRoaXMuX3BhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIHJlZ2lzdGVyIGNhbGxiYWNrXG4gICAgKi9cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTsgICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTsgICAgXG59IiwiXG4vKipcbiAqIFZhcmlhYmxlXG4gKiBcbiAqIFdyYXBwZXIgdG8gZXhwb3NlIGEgc2luZ2xlIGlkIChpdGVtKSBmcm9tIGEgY29sbGVjdGlvbiBhcyBhIHN0YW5kYWxvbmUgdmFyaWFibGVcbiAqIFxuICogLSBpZiB0aGVyZSBpcyBubyBpdGVtIHdpdGggaWQgaW4gY29sbGVjdGlvbiAtIHRoZSB2YXJpYWJsZSB3aWxsIGJlIHVuZGVmaW5lZFxuICogICBvciBoYXZlIGEgZGVmYXVsdCB2YWx1ZVxuICogLSBvdGhlcndpc2UsIHRoZSB2YXJpYWJsZSB3aWxsIGJlIHRoZSB2YWx1ZSBvZiBpdGVtLmRhdGFcbiAqIFxuICogIERlZmF1bHQgdmFsdWUgaXMgZ2l2ZW4gaW4gb3B0aW9ucyB7dmFsdWU6fVxuICovXG5cbmV4cG9ydCBjbGFzcyBWYXJpYWJsZSB7XG5cbiAgICBjb25zdHJ1Y3Rvcihjb2xsLCBpZCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl90ZXJtaW5pYXRlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb2xsID0gY29sbDtcbiAgICAgICAgdGhpcy5faWQgPSBpZDtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIC8vIGNhbGxiYWNrXG4gICAgICAgIHRoaXMuX2hhbmRsZXJzID0gW107XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpO1xuICAgIH1cblxuICAgIF9vbmNoYW5nZShkaWZmcykge1xuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwidmFyaWFibGUgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGZvciAoY29uc3QgZGlmZiBvZiBkaWZmcykge1xuICAgICAgICAgICAgaWYgKGRpZmYuaWQgPT0gdGhpcy5faWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9pdGVtID0gZGlmZi5uZXc7XG4gICAgICAgICAgICAgICAgdGhpcy5ub3RpZnlfY2FsbGJhY2tzKGRpZmYpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxuXG4gICAgYWRkX2NhbGxiYWNrIChoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtoYW5kbGVyOiBoYW5kbGVyfTtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMucHVzaChoYW5kbGUpO1xuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07XG4gICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgbGV0IGluZGV4ID0gdGhpcy5faGFuZGxlcnMuaW5kZXhPZihoYW5kbGUpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5faGFuZGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTtcbiAgICBcbiAgICBub3RpZnlfY2FsbGJhY2tzIChlQXJnKSB7XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLmZvckVhY2goZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgICAgICBoYW5kbGUuaGFuZGxlcihlQXJnKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIFxuICAgIHNldCAodmFsdWUpIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInZhcmlibGUgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGl0ZW1zID0gW3tpZDp0aGlzLl9pZCwgZGF0YTp2YWx1ZX1dO1xuICAgICAgICByZXR1cm4gdGhpcy5fY29sbC51cGRhdGUoe2luc2VydDppdGVtcywgcmVzZXQ6ZmFsc2V9KTtcbiAgICB9XG5cbiAgICBnZXQgKCkge1xuICAgICAgICBpZiAodGhpcy5fY29sbC5oYXModGhpcy5faWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fY29sbC5nZXQodGhpcy5faWQpLmRhdGE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fb3B0aW9ucy52YWx1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBzc19jbGllbnRfdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fY29sbC5yZW1vdmVfY2FsbGJhY2sodGhpcy5faGFuZGxlKTtcbiAgICB9XG59IiwiLy8gd2VicGFnZSBjbG9jayAtIHBlcmZvcm1hbmNlIG5vdyAtIHNlY29uZHNcbmNvbnN0IGxvY2FsID0ge1xuICAgIG5vdzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBwZXJmb3JtYW5jZS5ub3coKS8xMDAwLjA7XG4gICAgfVxufVxuLy8gc3lzdGVtIGNsb2NrIC0gZXBvY2ggLSBzZWNvbmRzXG5jb25zdCBlcG9jaCA9IHtcbiAgICBub3c6IGZ1bmN0aW9uKCkge1xuICAgICAgICByZXR1cm4gbmV3IERhdGUoKS8xMDAwLjA7XG4gICAgfVxufVxuXG4vKipcbiAqIENMT0NLIGdpdmVzIGVwb2NoIHZhbHVlcywgYnV0IGlzIGltcGxlbWVudGVkXG4gKiB1c2luZyBwZXJmb3JtYW5jZSBub3cgZm9yIGJldHRlclxuICogdGltZSByZXNvbHV0aW9uIGFuZCBwcm90ZWN0aW9uIGFnYWluc3Qgc3lzdGVtIFxuICogdGltZSBhZGp1c3RtZW50cy5cbiAqL1xuXG5jb25zdCBDTE9DSyA9IGZ1bmN0aW9uICgpIHtcbiAgICBjb25zdCB0MF9sb2NhbCA9IGxvY2FsLm5vdygpO1xuICAgIGNvbnN0IHQwX2Vwb2NoID0gZXBvY2gubm93KCk7XG4gICAgcmV0dXJuIHtcbiAgICAgICAgbm93OiBmdW5jdGlvbiAoKSB7XG4gICAgICAgICAgICBjb25zdCB0MV9sb2NhbCA9IGxvY2FsLm5vdygpO1xuICAgICAgICAgICAgcmV0dXJuIHQwX2Vwb2NoICsgKHQxX2xvY2FsIC0gdDBfbG9jYWwpO1xuICAgICAgICB9XG4gICAgfTtcbn0oKTtcblxuXG4vKipcbiAqIEVzdGltYXRlIHRoZSBjbG9jayBvZiB0aGUgc2VydmVyIFxuICovXG5cbmNvbnN0IE1BWF9TQU1QTEVfQ09VTlQgPSAzMDtcblxuZXhwb3J0IGNsYXNzIFNlcnZlckNsb2NrIHtcblxuICAgIGNvbnN0cnVjdG9yKHNzY2xpZW50KSB7XG4gICAgICAgIC8vIHNoYXJlc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIC8vIHBpbmdlclxuICAgICAgICB0aGlzLl9waW5nZXIgPSBuZXcgUGluZ2VyKHRoaXMuX29ucGluZy5iaW5kKHRoaXMpKTtcbiAgICAgICAgLy8gc2FtcGxlc1xuICAgICAgICB0aGlzLl9zYW1wbGVzID0gW107XG4gICAgICAgIC8vIGVzdGltYXRlc1xuICAgICAgICB0aGlzLl90cmFucyA9IDEwMDAuMDtcbiAgICAgICAgdGhpcy5fc2tldyA9IDAuMDtcbiAgICB9XG5cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIHRoaXMuX3Bpbmdlci5yZXN1bWUoKTtcbiAgICB9XG5cbiAgICBwYXVzZSgpIHtcbiAgICAgICAgdGhpcy5fcGluZ2VyLnBhdXNlKCk7XG4gICAgfVxuXG4gICAgX29ucGluZygpIHtcbiAgICAgICAgY29uc3QgdHMwID0gQ0xPQ0subm93KCk7XG4gICAgICAgIHRoaXMuX3NzY2xpZW50LmdldChcIi9jbG9ja1wiKS50aGVuKCh7b2ssIGRhdGF9KSA9PiB7XG4gICAgICAgICAgICBpZiAob2spIHtcbiAgICAgICAgICAgICAgICBjb25zdCB0czEgPSBDTE9DSy5ub3coKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9hZGRfc2FtcGxlKHRzMCwgZGF0YSwgdHMxKTsgICAgXG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9hZGRfc2FtcGxlKGNzLCBzcywgY3IpIHtcbiAgICAgICAgbGV0IHRyYW5zID0gKGNyIC0gY3MpIC8gMi4wO1xuICAgICAgICBsZXQgc2tldyA9IHNzIC0gKGNyICsgY3MpIC8gMi4wO1xuICAgICAgICBsZXQgc2FtcGxlID0gW2NzLCBzcywgY3IsIHRyYW5zLCBza2V3XTtcbiAgICAgICAgLy8gYWRkIHRvIHNhbXBsZXNcbiAgICAgICAgdGhpcy5fc2FtcGxlcy5wdXNoKHNhbXBsZSlcbiAgICAgICAgaWYgKHRoaXMuX3NhbXBsZXMubGVuZ3RoID4gTUFYX1NBTVBMRV9DT1VOVCkge1xuICAgICAgICAgICAgLy8gcmVtb3ZlIGZpcnN0IHNhbXBsZVxuICAgICAgICAgICAgdGhpcy5fc2FtcGxlcy5zaGlmdCgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIHJlZXZhbHVhdGUgZXN0aW1hdGVzIGZvciBza2V3IGFuZCB0cmFuc1xuICAgICAgICB0cmFucyA9IDEwMDAwMC4wO1xuICAgICAgICBza2V3ID0gMC4wO1xuICAgICAgICBmb3IgKGNvbnN0IHNhbXBsZSBvZiB0aGlzLl9zYW1wbGVzKSB7XG4gICAgICAgICAgICBpZiAoc2FtcGxlWzNdIDwgdHJhbnMpIHtcbiAgICAgICAgICAgICAgICB0cmFucyA9IHNhbXBsZVszXTtcbiAgICAgICAgICAgICAgICBza2V3ID0gc2FtcGxlWzRdO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3NrZXcgPSBza2V3O1xuICAgICAgICB0aGlzLl90cmFucyA9IHRyYW5zO1xuICAgIH1cblxuICAgIGdldCBza2V3KCkge3JldHVybiB0aGlzLl9za2V3O31cbiAgICBnZXQgdHJhbnMoKSB7cmV0dXJuIHRoaXMuX3RyYW5zO31cblxuICAgIG5vdygpIHtcbiAgICAgICAgLy8gc2VydmVyIGNsb2NrIGlzIGxvY2FsIGNsb2NrICsgZXN0aW1hdGVkIHNrZXdcbiAgICAgICAgcmV0dXJuIENMT0NLLm5vdygpICsgdGhpcy5fc2tldztcbiAgICB9XG5cbn1cblxuXG4vKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgUElOR0VSXG4qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4vKipcbiAqIFBpbmdlciBpbnZva2VzIGEgY2FsbGJhY2sgcmVwZWF0ZWRseSwgaW5kZWZpbml0ZWx5LiBcbiAqIFBpbmdpbmcgaW4gMyBzdGFnZXMsIGZpcnN0IGZyZXF1ZW50bHksIHRoZW4gbW9kZXJhdGVseSwgXG4gKiB0aGVuIHNsb3dseS5cbiAqL1xuXG5jb25zdCBTTUFMTF9ERUxBWSA9IDIwOyAvLyBtc1xuY29uc3QgTUVESVVNX0RFTEFZID0gNTAwOyAvLyBtc1xuY29uc3QgTEFSR0VfREVMQVkgPSAxMDAwMDsgLy8gbXNcblxuY29uc3QgREVMQVlfU0VRVUVOQ0UgPSBbXG4gICAgLi4ubmV3IEFycmF5KDMpLmZpbGwoU01BTExfREVMQVkpLCBcbiAgICAuLi5uZXcgQXJyYXkoNykuZmlsbChNRURJVU1fREVMQVkpLFxuICAgIC4uLltMQVJHRV9ERUxBWV1cbl07XG5cbmNsYXNzIFBpbmdlciB7XG5cbiAgICBjb25zdHJ1Y3RvciAoY2FsbGJhY2spIHtcbiAgICAgICAgdGhpcy5fY291bnQgPSAwO1xuICAgICAgICB0aGlzLl90aWQgPSB1bmRlZmluZWQ7XG4gICAgICAgIHRoaXMuX2NhbGxiYWNrID0gY2FsbGJhY2s7XG4gICAgICAgIHRoaXMuX3BpbmcgPSB0aGlzLnBpbmcuYmluZCh0aGlzKTtcbiAgICAgICAgdGhpcy5fZGVsYXlzID0gWy4uLkRFTEFZX1NFUVVFTkNFXTtcbiAgICB9XG4gICAgcGF1c2UoKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgIH1cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgICAgICB0aGlzLnBpbmcoKTtcbiAgICB9XG4gICAgcmVzdGFydCgpIHtcbiAgICAgICAgdGhpcy5fZGVsYXlzID0gWy4uLkRFTEFZX1NFUVVFTkNFXTtcbiAgICAgICAgY2xlYXJUaW1lb3V0KHRoaXMuX3RpZCk7XG4gICAgICAgIHRoaXMucGluZygpO1xuICAgIH1cbiAgICBwaW5nICgpIHtcbiAgICAgICAgbGV0IG5leHRfZGVsYXkgPSB0aGlzLl9kZWxheXNbMF07XG4gICAgICAgIGlmICh0aGlzLl9kZWxheXMubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgdGhpcy5fZGVsYXlzLnNoaWZ0KCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2NhbGxiYWNrKSB7XG4gICAgICAgICAgICB0aGlzLl9jYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX3RpZCA9IHNldFRpbWVvdXQodGhpcy5fcGluZywgbmV4dF9kZWxheSk7XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IFdlYlNvY2tldElPIH0gZnJvbSBcIi4vd3Npby5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5pbXBvcnQgeyBDb2xsZWN0aW9uIH0gZnJvbSBcIi4vY29sbGVjdGlvbi5qc1wiO1xuaW1wb3J0IHsgVmFyaWFibGUgfSBmcm9tIFwiLi92YXJpYWJsZS5qc1wiO1xuaW1wb3J0IHsgU2VydmVyQ2xvY2sgfSBmcm9tIFwiLi9zZXJ2ZXJjbG9jay5qc1wiO1xuXG5jb25zdCBNc2dUeXBlID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgTUVTU0FHRSA6IFwiTUVTU0FHRVwiLFxuICAgIFJFUVVFU1Q6IFwiUkVRVUVTVFwiLFxuICAgIFJFUExZOiBcIlJFUExZXCJcbiB9KTtcbiBcbmNvbnN0IE1zZ0NtZCA9IE9iamVjdC5mcmVlemUoe1xuICAgIEdFVCA6IFwiR0VUXCIsXG4gICAgUFVUOiBcIlBVVFwiLFxuICAgIE5PVElGWTogXCJOT1RJRllcIlxufSk7XG5cblxuZXhwb3J0IGNsYXNzIFNoYXJlZFN0YXRlQ2xpZW50IGV4dGVuZHMgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IgKHVybCwgb3B0aW9ucykge1xuICAgICAgICBzdXBlcih1cmwsIG9wdGlvbnMpO1xuXG4gICAgICAgIC8vIHJlcXVlc3RzXG4gICAgICAgIHRoaXMuX3JlcWlkID0gMDtcbiAgICAgICAgdGhpcy5fcGVuZGluZyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBzdWJzY3JpcHRpb25zXG4gICAgICAgIC8vIHBhdGggLT4ge30gXG4gICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIGNvbGxlY3Rpb25zIHtwYXRoIC0+IGNvbGxlY3Rpb259XG4gICAgICAgIHRoaXMuX2NvbGxfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHZhcmlhYmxlcyB7W3BhdGgsIGlkXSAtPiB2YXJpYWJsZX1cbiAgICAgICAgdGhpcy5fdmFyX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2tcbiAgICAgICAgdGhpcy5fc2VydmVyX2Nsb2NrO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQ09OTkVDVElPTiBcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gcmVmcmVzaCBsb2NhbCBzdXNjcmlwdGlvbnNcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gc2VydmVyIGNsb2NrXG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucmVzdW1lKCk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgICAgICAvLyBzZXJ2ZXIgY2xvY2tcbiAgICAgICAgaWYgKHRoaXMuX3NlcnZlcl9jbG9jayAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHRoaXMuX3NlcnZlcl9jbG9jay5wYXVzZSgpO1xuICAgICAgICB9XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29tbXVuaWNhdGlvbiBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBIQU5ETEVSU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBsZXQgbXNnID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuUkVQTFkpIHtcbiAgICAgICAgICAgIGxldCByZXFpZCA9IG1zZy50dW5uZWw7XG4gICAgICAgICAgICBpZiAodGhpcy5fcGVuZGluZy5oYXMocmVxaWQpKSB7XG4gICAgICAgICAgICAgICAgbGV0IHJlc29sdmVyID0gdGhpcy5fcGVuZGluZy5nZXQocmVxaWQpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3BlbmRpbmcuZGVsZXRlKHJlcWlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCB7b2ssIGRhdGF9ID0gbXNnO1xuICAgICAgICAgICAgICAgIHJlc29sdmVyKHtvaywgZGF0YX0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuTUVTU0FHRSkge1xuICAgICAgICAgICAgaWYgKG1zZy5jbWQgPT0gTXNnQ21kLk5PVElGWSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2hhbmRsZV9ub3RpZnkobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9oYW5kbGVfbm90aWZ5KG1zZykge1xuICAgICAgICAvLyB1cGRhdGUgY29sbGVjdGlvbiBzdGF0ZVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChtc2dbXCJwYXRoXCJdKTtcbiAgICAgICAgaWYgKGRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZHMuX3NzY2xpZW50X3VwZGF0ZShtc2dbXCJkYXRhXCJdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0VSVkVSIFJFUVVFU1RTXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgX3JlcXVlc3QoY21kLCBwYXRoLCBhcmcpIHtcbiAgICAgICAgY29uc3QgcmVxaWQgPSB0aGlzLl9yZXFpZCsrO1xuICAgICAgICBjb25zdCBtc2cgPSB7XG4gICAgICAgICAgICB0eXBlOiBNc2dUeXBlLlJFUVVFU1QsXG4gICAgICAgICAgICBjbWQsIFxuICAgICAgICAgICAgcGF0aCwgXG4gICAgICAgICAgICBhcmcsXG4gICAgICAgICAgICB0dW5uZWw6IHJlcWlkXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuc2VuZChKU09OLnN0cmluZ2lmeShtc2cpKTtcbiAgICAgICAgbGV0IFtwcm9taXNlLCByZXNvbHZlcl0gPSByZXNvbHZhYmxlUHJvbWlzZSgpO1xuICAgICAgICB0aGlzLl9wZW5kaW5nLnNldChyZXFpZCwgcmVzb2x2ZXIpO1xuICAgICAgICByZXR1cm4gcHJvbWlzZS50aGVuKCh7b2ssIGRhdGF9KSA9PiB7XG4gICAgICAgICAgICAvLyBzcGVjaWFsIGhhbmRsaW5nIGZvciByZXBsaWVzIHRvIFBVVCAvc3Vic1xuICAgICAgICAgICAgaWYgKGNtZCA9PSBNc2dDbWQuUFVUICYmIHBhdGggPT0gXCIvc3Vic1wiICYmIG9rKSB7XG4gICAgICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnNjcmlwdGlvbiBzdGF0ZVxuICAgICAgICAgICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcChkYXRhKVxuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmV0dXJuIHtvaywgcGF0aCwgZGF0YX07XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9zdWIgKHBhdGgpIHtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAgICAgLy8gc2V0IG5ldyBwYXRoXG4gICAgICAgICAgICBzdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnRoaXMuX3N1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3VicyAtIHN1YnNjcmliZSBvbiByZWNvbm5lY3RcbiAgICAgICAgICAgIHRoaXMuX3N1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKHtvazogdHJ1ZSwgcGF0aCwgZGF0YTp1bmRlZmluZWR9KVxuICAgICAgICB9XG5cbiAgICB9XG5cbiAgICBfdW5zdWIgKHBhdGgpIHtcbiAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAvLyByZW1vdmUgcGF0aFxuICAgICAgICBzdWJzX21hcC5kZWxldGUocGF0aClcbiAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4uc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLy8gYWNjc2Vzc29yIGZvciBzZXJ2ZXIgY2xvY2tcbiAgICBnZXQgY2xvY2soKSB7XG4gICAgICAgIGlmICh0aGlzLl9zZXJ2ZXJfY2xvY2sgPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sgPSBuZXcgU2VydmVyQ2xvY2sodGhpcyk7XG4gICAgICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9zZXJ2ZXJfY2xvY2sucmVzdW1lKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX3NlcnZlcl9jbG9jaztcbiAgICB9XG5cbiAgICAvLyBnZXQgcmVxdWVzdCBmb3IgaXRlbXMgYnkgcGF0aFxuICAgIGdldChwYXRoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5HRVQsIHBhdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyB1cGRhdGUgcmVxdWVzdCBmb3IgcGF0aFxuICAgIHVwZGF0ZShwYXRoLCBjaGFuZ2VzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5QVVQsIHBhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFjcXVpcmUgY29sbGVjdGlvbiBmb3IgcGF0aFxuICAgICAqIC0gYXV0b21hdGljYWxseSBzdWJzY3JpYmVzIHRvIHBhdGggaWYgbmVlZGVkXG4gICAgICovXG4gICAgYWNxdWlyZV9jb2xsZWN0aW9uIChwYXRoLCBvcHRpb25zKSB7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBzdWJzY3JpcHRpb24gZG9lcyBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBjb2xsZWN0aW9uIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9jb2xsX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2NvbGxfbWFwLnNldChwYXRoLCBuZXcgQ29sbGVjdGlvbih0aGlzLCBwYXRoLCBvcHRpb25zKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIHZhcmlhYmxlIGZvciAocGF0aCwgbmFtZSlcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgYWNxdWlyZSBjb2xsZWN0aW9uXG4gICAgICovXG4gICAgYWNxdWlyZV92YXJpYWJsZSAocGF0aCwgbmFtZSwgb3B0aW9ucykge1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuYWNxdWlyZV9jb2xsZWN0aW9uKHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgdmFyaWFibGUgaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX3Zhcl9tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl92YXJfbWFwLnNldChwYXRoLCBuZXcgTWFwKCkpO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHZhcl9tYXAgPSB0aGlzLl92YXJfbWFwLmdldChwYXRoKTtcbiAgICAgICAgaWYgKCF2YXJfbWFwLmdldChuYW1lKSkge1xuICAgICAgICAgICAgdmFyX21hcC5zZXQobmFtZSwgbmV3IFZhcmlhYmxlKGRzLCBuYW1lLCBvcHRpb25zKSlcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdmFyX21hcC5nZXQobmFtZSlcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiByZWxlYXNlIHBhdGgsIGluY2x1ZGluZyBjb2xsZWN0aW9uIGFuZCB2YXJpYWJsZXNcbiAgICAgKi9cbiAgICByZWxlYXNlKHBhdGgpIHtcbiAgICAgICAgLy8gdW5zdWJzY3JpYmVcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fdW5zdWIocGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gdGVybWluYXRlIGNvbGxlY3Rpb24gYW5kIHZhcmlhYmxlc1xuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2NvbGxfbWFwLmdldChwYXRoKTtcbiAgICAgICAgZHMuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICBjb25zdCB2YXJfbWFwID0gdGhpcy5fdmFyX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmICh2YXJfbWFwICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCB2IG9mIHZhcl9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgICAgICB2Ll9zc2NsaWVudF90ZXJtaW5hdGUoKTtcbiAgICAgICAgICAgIH0gICAgXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29sbF9tYXAuZGVsZXRlKHBhdGgpO1xuICAgICAgICB0aGlzLl92YXJfbWFwLmRlbGV0ZShwYXRoKTtcbiAgICB9XG59XG5cblxuIiwiLypcbiAgICBDb2xsZWN0aW9uIFZpZXdlclxuKi9cblxuZnVuY3Rpb24gaXRlbTJzdHJpbmcoaXRlbSkge1xuICAgIGNvbnN0IHtpZCwgaXR2LCBkYXRhfSA9IGl0ZW07XG4gICAgbGV0IGRhdGFfdHh0ID0gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgbGV0IGl0dl90eHQgPSAoaXR2ICE9IHVuZGVmaW5lZCkgPyBKU09OLnN0cmluZ2lmeShpdHYpIDogXCJcIjtcbiAgICBsZXQgaWRfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImlkXCI+JHtpZH08L3NwYW4+YDtcbiAgICBsZXQgaXR2X2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpdHZcIj4ke2l0dl90eHR9PC9zcGFuPmA7XG4gICAgbGV0IGRhdGFfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImRhdGFcIj4ke2RhdGFfdHh0fTwvc3Bhbj5gO1xuICAgIHJldHVybiBgXG4gICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8YnV0dG9uIGlkPVwiZGVsZXRlXCI+WDwvYnV0dG9uPlxuICAgICAgICAgICAgJHtpZF9odG1sfTogJHtpdHZfaHRtbH0gJHtkYXRhX2h0bWx9XG4gICAgICAgIDwvZGl2PmA7XG59XG5cblxuZXhwb3J0IGNsYXNzIENvbGxlY3Rpb25WaWV3ZXIge1xuXG4gICAgY29uc3RydWN0b3IoY29sbGVjdGlvbiwgZWxlbSwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl9jb2xsID0gY29sbGVjdGlvbjtcbiAgICAgICAgdGhpcy5fZWxlbSA9IGVsZW07XG4gICAgICAgIHRoaXMuX2hhbmRsZSA9IHRoaXMuX2NvbGwuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpOyBcblxuICAgICAgICAvLyBvcHRpb25zXG4gICAgICAgIGxldCBkZWZhdWx0cyA9IHtcbiAgICAgICAgICAgIGRlbGV0ZTpmYWxzZSxcbiAgICAgICAgICAgIHRvU3RyaW5nOml0ZW0yc3RyaW5nXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSB7Li4uZGVmYXVsdHMsIC4uLm9wdGlvbnN9O1xuXG4gICAgICAgIC8qXG4gICAgICAgICAgICBTdXBwb3J0IGRlbGV0ZVxuICAgICAgICAqL1xuICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5kZWxldGUpIHtcbiAgICAgICAgICAgIC8vIGxpc3RlbiBmb3IgY2xpY2sgZXZlbnRzIG9uIHJvb3QgZWxlbWVudFxuICAgICAgICAgICAgZWxlbS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYXRjaCBjbGljayBldmVudCBmcm9tIGRlbGV0ZSBidXR0b25cbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVCdG4gPSBlLnRhcmdldC5jbG9zZXN0KFwiI2RlbGV0ZVwiKTtcbiAgICAgICAgICAgICAgICBpZiAoZGVsZXRlQnRuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpc3RJdGVtID0gZGVsZXRlQnRuLmNsb3Nlc3QoXCIubGlzdC1pdGVtXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobGlzdEl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2NvbGwudXBkYXRlKHtyZW1vdmU6W2xpc3RJdGVtLmlkXX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIHJlbmRlciBpbml0aWFsIHN0YXRlXG4gICAgICAgICovIFxuICAgICAgICBjb25zdCBkaWZmcyA9IHRoaXMuX2NvbGwuZ2V0KClcbiAgICAgICAgICAgIC5tYXAoaXRlbSA9PiB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIHtpZDppdGVtLmlkLCBuZXc6aXRlbX1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB0aGlzLl9vbmNoYW5nZShkaWZmcyk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGNvbnN0IHt0b1N0cmluZ30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBmb3IgKGxldCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5uZXcpIHtcbiAgICAgICAgICAgICAgICAvLyBhZGRcbiAgICAgICAgICAgICAgICBsZXQgbm9kZSA9IHRoaXMuX2VsZW0ucXVlcnlTZWxlY3RvcihgIyR7ZGlmZi5pZH1gKTtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZShcImlkXCIsIGRpZmYuaWQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNsYXNzTGlzdC5hZGQoXCJsaXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VsZW0uYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5vZGUuaW5uZXJIVE1MID0gdG9TdHJpbmcoZGlmZi5uZXcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkaWZmLm9sZCkge1xuICAgICAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0lBQUE7SUFDQTtJQUNBO0lBQ0E7SUFDQTs7SUFFTyxTQUFTLGlCQUFpQixHQUFHO0lBQ3BDLElBQUksSUFBSSxRQUFRO0lBQ2hCLElBQUksSUFBSSxPQUFPLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxLQUFLO0lBQ25ELFFBQVEsUUFBUSxHQUFHLE9BQU87SUFDMUIsS0FBSyxDQUFDO0lBQ04sSUFBSSxPQUFPLENBQUMsT0FBTyxFQUFFLFFBQVEs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
