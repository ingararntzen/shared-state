
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var DATACANNON = (function (exports) {
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

    class Dataset {

        constructor(dcclient, path) {
            // dcclient
            this._dcclient = dcclient;
            this._path = path;
            // callbacks
            this._handlers = [];
            // items
            this._map = new Map();
        }

        /*********************************************************
            DC CLIENT API
        **********************************************************/

        /**
         * server update dataset 
         */
        _dcclient_update (changes={}) {

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

        /**
         * application requesting items
         */
        get_items() {
            return [...this._map.values()];
        };

        get size() {return this._map.size}


        /**
         * application dispatching update to server
         */
        update (changes={}) {
            return this._dcclient.update(this._path, changes);
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
     * Estimate the clock of the dcserver 
     */

    const MAX_SAMPLE_COUNT = 30;

    class ServerClock {

        constructor(dcclient) {
            // dcclient
            this._dcclient = dcclient;
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
            this._dcclient.get("/clock").then(({data}) => {
                const ts1 = CLOCK.now();
                this._add_sample(ts0, data, ts1);
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

    const SWITCH_MEDIUM = 3; // count
    const SWITCH_LARGE = 10; // count
    const SMALL_DELTA = 20; // ms
    const MEDIUM_DELTA = 500; // ms
    const LARGE_DELTA = 10000; // ms

    class Pinger {

        constructor (callback) {
            this._count = 0;
            this._tid = undefined;
            this._callback = callback;
            this._ping = this.ping.bind(this);
        }
        pause() {
            clearTimeout(this._tid);
        }
        resume() {
            clearTimeout(this._tid);
            this.ping();
        }
        restart() {
            this._count = 0;
            clearTimeout(this._tid);
            this.ping();
        }
        ping () {
            this._count += 1;
            if (this._count < SWITCH_MEDIUM) {
                this._tid = setTimeout(this._ping, SMALL_DELTA);
            } else if (this._count < SWITCH_LARGE) {
                this._tid = setTimeout(this._ping, MEDIUM_DELTA);
            } else {
                this._tid = setTimeout(this._ping, LARGE_DELTA);
            }
            if (this._callback) {
                this._callback();
            }
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


    class DataCannon extends WebSocketIO {

        constructor (url, options) {
            super(url, options);

            // requests
            this._reqid = 0;
            this._pending = new Map();

            // subscriptions
            // path -> {} 
            this._subs_map = new Map();

            // datasets
            // path -> ds
            this._ds_map = new Map();
            this._ds_handle_map = new Map();

            // clock
            this._clock = new ServerClock(this);
        }

        /*********************************************************************
            CONNECTION 
        *********************************************************************/

        on_connect() {
            // activate server clock
            this._clock.resume();

            console.log(`Connect  ${this.url}`);
            // refresh local suscriptions
            if (this._subs_map.size > 0) {
                const items = [...this._subs_map.entries()];
                this.update("/subs", {insert:items, reset:true});
            }
        }
        on_disconnect() {
            this._clock.pause();
            console.error(`Disconnect ${this.url}`);
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
            // update dataset state
            const ds = this._ds_map.get(msg["path"]);
            if (ds != undefined) {
                ds._dcclient_update(msg["data"]);
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

        get(path) {
            return this._request(MsgCmd.GET, path);
        }
        
        update(path, changes) {
            return this._request(MsgCmd.PUT, path, changes);
        }

        /**
         * acquire dataset for path
         * - automatically subscribes to path if needed
         * returns handle and dataset
         * handle used to release dataset
         */

        acquire (path) {
            // subscribe if not exists
            if (!this._subs_map.has(path)) {
                // subscribe to path
                this._sub(path);
            }
            // create dataset if not exists
            if (!this._ds_map.has(path)) {
                this._ds_map.set(path, new Dataset(this, path));
            }
            const ds = this._ds_map.get(path);
            // create handle for path
            const handle = {path};
            if (!this._ds_handle_map.has(path)) {
                this._ds_handle_map.set(path, []);
            }
            this._ds_handle_map.get(path).push(handle);
            return [handle, ds];
        }

        /**
         * release dataset by handle
         * - automatically unsubscribe if all handles have been released
         */

        release (handle) {
            const path = handle.path;
            const handles = this._ds_handle_map.get(path);
            if (handles == undefined) {
                return;
            }
            // remove handle
            const index = handles.indexOf(handle);
            if (index > -1) {
                handles.splice(index, 1);
            }
            // clean up if last handle released
            if (handles.length == 0) {
                this._unsub(path);
                // clear/disable dataset
                // const ds = this._ds_map.get(path);
                this._ds_map.delete(path);
            }
        }


        /**
         * server clock
         */
        get clock () {
            return this._clock;
        }

    }

    /*
        Dataset Viewer
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


    class DatasetViewer {

        constructor(dataset, elem, options={}) {
            this._ds = dataset;
            this._elem = elem;
            this._ds.add_callback(this._onchange.bind(this)); 

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
                            this._ds.update({remove:[listItem.id]});
                            e.stopPropagation();
                        }
                    }
                });
            }
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

    exports.DataCannon = DataCannon;
    exports.DatasetViewer = DatasetViewer;

    return exports;

})({});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YWNhbm5vbi5paWZlLmpzIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY2xpZW50L3V0aWwuanMiLCIuLi8uLi9zcmMvY2xpZW50L3dzaW8uanMiLCIuLi8uLi9zcmMvY2xpZW50L2RhdGFzZXQuanMiLCIuLi8uLi9zcmMvY2xpZW50L2Nsb2NrLmpzIiwiLi4vLi4vc3JjL2NsaWVudC9kY19jbGllbnQuanMiLCIuLi8uLi9zcmMvY2xpZW50L3ZpZXdlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICAgIENyZWF0ZSBhIHByb21pc2Ugd2hpY2ggY2FuIGJlIHJlc29sdmVkXG4gICAgcHJvZ3JhbW1hdGljYWxseSBieSBleHRlcm5hbCBjb2RlLlxuICAgIFJldHVybiBhIHByb21pc2UgYW5kIGEgcmVzb2x2ZSBmdW5jdGlvblxuKi9cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmFibGVQcm9taXNlKCkge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcmVzb2x2ZXIgPSByZXNvbHZlO1xuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZW91dFByb21pc2UgKG1zKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBsZXQgdGlkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9LCBtcyk7XG4gICAgICAgIHJlc29sdmVyID0gKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRpZCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzb2x2ZShmYWxzZSk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn0iLCJpbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuY29uc3QgTUFYX1JFVFJJRVMgPSA0O1xuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IodXJsLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3VybCA9IHVybDtcbiAgICAgICAgdGhpcy5fd3M7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgIH1cblxuICAgIGdldCBjb25uZWN0aW5nKCkge3JldHVybiB0aGlzLl9jb25uZWN0aW5nO31cbiAgICBnZXQgY29ubmVjdGVkKCkge3JldHVybiB0aGlzLl9jb25uZWN0ZWQ7fVxuICAgIGdldCB1cmwoKSB7cmV0dXJuIHRoaXMuX3VybDt9XG4gICAgZ2V0IG9wdGlvbnMoKSB7cmV0dXJuIHRoaXMuX29wdGlvbnM7fVxuXG4gICAgY29ubmVjdCgpIHtcblxuICAgICAgICBpZiAodGhpcy5jb25uZWN0aW5nIHx8IHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkNvbm5lY3Qgd2hpbGUgY29ubmVjdGluZyBvciBjb25uZWN0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2lzX3Rlcm1pbmF0ZWQoKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJUZXJtaW5hdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gY29ubmVjdGluZ1xuICAgICAgICB0aGlzLl93cyA9IG5ldyBXZWJTb2NrZXQodGhpcy5fdXJsKTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuX3dzLm9ub3BlbiA9IGUgPT4gdGhpcy5fb25fb3BlbihlKTtcbiAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gZSA9PiB0aGlzLm9uX21lc3NhZ2UoZS5kYXRhKTtcbiAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IGUgPT4gdGhpcy5fb25fY2xvc2UoZSk7XG4gICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSBlID0+IHRoaXMub25fZXJyb3IoZSk7XG4gICAgICAgIHRoaXMub25fY29ubmVjdGluZygpO1xuICAgIH1cblxuICAgIF9vbl9vcGVuKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gcmVsZWFzZSBjb25uZWN0IHByb21pc2VzXG4gICAgICAgIGZvciAoY29uc3QgcmVzb2x2ZXIgb2YgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycykge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgICAgIC8vIHJlc2V0IHJldHJpZXMgb24gc3VjY2Vzc2Z1bCBjb25uZWN0aW9uXG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3QoKTtcbiAgICB9XG5cbiAgICBfb25fY2xvc2UoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5vbl9kaXNjb25uZWN0KGV2ZW50KTtcbiAgICAgICAgdGhpcy5fcmV0cmllcyArPSAxO1xuICAgICAgICBpZiAoIXRoaXMuX2lzX3Rlcm1pbmF0ZWQoKSkge1xuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0KCk7XG4gICAgICAgICAgICB9LCAxMDAwICogdGhpcy5fcmV0cmllcyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgX2lzX3Rlcm1pbmF0ZWQoKSB7XG4gICAgICAgIGNvbnN0IHtyZXRyaWVzPU1BWF9SRVRSSUVTfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmICh0aGlzLl9yZXRyaWVzID49IHJldHJpZXMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBUZXJtaW5hdGVkOiBNYXggcmV0cmllcyByZWFjaGVkICgke3JldHJpZXN9KWApO1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9ub3BlbiA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3MgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgb25fY29ubmVjdGluZygpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBDb25uZWN0aW5nICR7dGhpcy51cmx9YCk7fVxuICAgIH1cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fZXJyb3IoZXJyb3IpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuICAgIG9uX2Rpc2Nvbm5lY3QoZXZlbnQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBSZWNlaXZlOiAke2RhdGF9YCk7fVxuICAgIH1cblxuICAgIHNlbmQoZGF0YSkge1xuICAgICAgICBpZiAodGhpcy5fY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3dzLnNlbmQoZGF0YSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFNlbmQgZmFpbDogJHtlcnJvcn1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZW5kIGRyb3AgOiBub3QgY29ubmVjdGVkYClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbm5lY3RlZFByb21pc2UoKSB7XG4gICAgICAgIGNvbnN0IFtwcm9taXNlLCByZXNvbHZlcl0gPSByZXNvbHZhYmxlUHJvbWlzZSgpO1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzLnB1c2gocmVzb2x2ZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgIH1cbn1cblxuXG4iLCJcblxuZXhwb3J0IGNsYXNzIERhdGFzZXQge1xuXG4gICAgY29uc3RydWN0b3IoZGNjbGllbnQsIHBhdGgpIHtcbiAgICAgICAgLy8gZGNjbGllbnRcbiAgICAgICAgdGhpcy5fZGNjbGllbnQgPSBkY2NsaWVudDtcbiAgICAgICAgdGhpcy5fcGF0aCA9IHBhdGg7XG4gICAgICAgIC8vIGNhbGxiYWNrc1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgICAgICAvLyBpdGVtc1xuICAgICAgICB0aGlzLl9tYXAgPSBuZXcgTWFwKCk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBEQyBDTElFTlQgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8qKlxuICAgICAqIHNlcnZlciB1cGRhdGUgZGF0YXNldCBcbiAgICAgKi9cbiAgICBfZGNjbGllbnRfdXBkYXRlIChjaGFuZ2VzPXt9KSB7XG5cbiAgICAgICAgY29uc3Qge3JlbW92ZSwgaW5zZXJ0LCByZXNldD1mYWxzZX0gPSBjaGFuZ2VzO1xuICAgICAgICBjb25zdCBkaWZmX21hcCA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyByZW1vdmUgaXRlbXMgLSBjcmVhdGUgZGlmZlxuICAgICAgICBpZiAocmVzZXQpIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB0aGlzLl9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgICAgICBkaWZmX21hcC5zZXQoXG4gICAgICAgICAgICAgICAgICAgIGl0ZW0uaWQsIFxuICAgICAgICAgICAgICAgICAgICB7aWQ6IGl0ZW0uaWQsIG5ldzp1bmRlZmluZWQsIG9sZDppdGVtfVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB0aGlzLl9tYXAgPSBuZXcgTWFwKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IF9pZCBvZiByZW1vdmUpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBvbGQgPSB0aGlzLl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICAgICAgaWYgKG9sZCAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fbWFwLmRlbGV0ZShfaWQpO1xuICAgICAgICAgICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6dW5kZWZpbmVkLCBvbGR9KTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBpbnNlcnQgaXRlbXMgLSB1cGRhdGUgZGlmZlxuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaW5zZXJ0KSB7XG4gICAgICAgICAgICBjb25zdCBfaWQgPSBpdGVtLmlkO1xuICAgICAgICAgICAgLy8gb2xkIGZyb20gZGlmZl9tYXAgb3IgX21hcFxuICAgICAgICAgICAgY29uc3QgZGlmZiA9IGRpZmZfbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgY29uc3Qgb2xkID0gKGRpZmYgIT0gdW5kZWZpbmVkKSA/IGRpZmYub2xkIDogdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgLy8gc2V0IHN0YXRlXG4gICAgICAgICAgICB0aGlzLl9tYXAuc2V0KF9pZCwgaXRlbSk7XG4gICAgICAgICAgICAvLyB1cGRhdGUgZGlmZiBtYXBcbiAgICAgICAgICAgIGRpZmZfbWFwLnNldChfaWQsIHtpZDpfaWQsIG5ldzppdGVtLCBvbGR9KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9ub3RpZnlfY2FsbGJhY2tzKFsuLi5kaWZmX21hcC52YWx1ZXMoKV0pO1xuICAgIH1cblxuICAgIF9ub3RpZnlfY2FsbGJhY2tzIChlQXJnKSB7XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLmZvckVhY2goZnVuY3Rpb24oaGFuZGxlKSB7XG4gICAgICAgICAgICBoYW5kbGUuaGFuZGxlcihlQXJnKTtcbiAgICAgICAgfSk7XG4gICAgfTtcblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQVBQTElDQVRJT04gQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIHJlcXVlc3RpbmcgaXRlbXNcbiAgICAgKi9cbiAgICBnZXRfaXRlbXMoKSB7XG4gICAgICAgIHJldHVybiBbLi4udGhpcy5fbWFwLnZhbHVlcygpXTtcbiAgICB9O1xuXG4gICAgZ2V0IHNpemUoKSB7cmV0dXJuIHRoaXMuX21hcC5zaXplfVxuXG5cbiAgICAvKipcbiAgICAgKiBhcHBsaWNhdGlvbiBkaXNwYXRjaGluZyB1cGRhdGUgdG8gc2VydmVyXG4gICAgICovXG4gICAgdXBkYXRlIChjaGFuZ2VzPXt9KSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9kY2NsaWVudC51cGRhdGUodGhpcy5fcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVnaXN0ZXIgY2FsbGJhY2tcbiAgICAqL1xuICAgIGFkZF9jYWxsYmFjayAoaGFuZGxlcikge1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB7aGFuZGxlcn07XG4gICAgICAgIHRoaXMuX2hhbmRsZXJzLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIGhhbmRsZTtcbiAgICB9OyAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuX2hhbmRsZXJzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIHRoaXMuX2hhbmRsZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9OyAgICBcbn0iLCIvLyB3ZWJwYWdlIGNsb2NrIC0gcGVyZm9ybWFuY2Ugbm93IC0gc2Vjb25kc1xuY29uc3QgbG9jYWwgPSB7XG4gICAgbm93OiBmdW5jdGlvbigpIHtcbiAgICAgICAgcmV0dXJuIHBlcmZvcm1hbmNlLm5vdygpLzEwMDAuMDtcbiAgICB9XG59XG4vLyBzeXN0ZW0gY2xvY2sgLSBlcG9jaCAtIHNlY29uZHNcbmNvbnN0IGVwb2NoID0ge1xuICAgIG5vdzogZnVuY3Rpb24oKSB7XG4gICAgICAgIHJldHVybiBuZXcgRGF0ZSgpLzEwMDAuMDtcbiAgICB9XG59XG5cbi8qKlxuICogQ0xPQ0sgZ2l2ZXMgZXBvY2ggdmFsdWVzLCBidXQgaXMgaW1wbGVtZW50ZWRcbiAqIHVzaW5nIHBlcmZvcm1hbmNlIG5vdyBmb3IgYmV0dGVyXG4gKiB0aW1lIHJlc29sdXRpb24gYW5kIHByb3RlY3Rpb24gYWdhaW5zdCBzeXN0ZW0gXG4gKiB0aW1lIGFkanVzdG1lbnRzLlxuICovXG5cbmNvbnN0IENMT0NLID0gZnVuY3Rpb24gKCkge1xuICAgIGNvbnN0IHQwX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgY29uc3QgdDBfZXBvY2ggPSBlcG9jaC5ub3coKTtcbiAgICByZXR1cm4ge1xuICAgICAgICBub3c6IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIGNvbnN0IHQxX2xvY2FsID0gbG9jYWwubm93KCk7XG4gICAgICAgICAgICByZXR1cm4gdDBfZXBvY2ggKyAodDFfbG9jYWwgLSB0MF9sb2NhbCk7XG4gICAgICAgIH1cbiAgICB9O1xufSgpO1xuXG5cbi8qKlxuICogRXN0aW1hdGUgdGhlIGNsb2NrIG9mIHRoZSBkY3NlcnZlciBcbiAqL1xuXG5jb25zdCBNQVhfU0FNUExFX0NPVU5UID0gMzA7XG5cbmV4cG9ydCBjbGFzcyBTZXJ2ZXJDbG9jayB7XG5cbiAgICBjb25zdHJ1Y3RvcihkY2NsaWVudCkge1xuICAgICAgICAvLyBkY2NsaWVudFxuICAgICAgICB0aGlzLl9kY2NsaWVudCA9IGRjY2xpZW50O1xuICAgICAgICAvLyBwaW5nZXJcbiAgICAgICAgdGhpcy5fcGluZ2VyID0gbmV3IFBpbmdlcih0aGlzLl9vbnBpbmcuYmluZCh0aGlzKSk7XG4gICAgICAgIC8vIHNhbXBsZXNcbiAgICAgICAgdGhpcy5fc2FtcGxlcyA9IFtdO1xuICAgICAgICAvLyBlc3RpbWF0ZXNcbiAgICAgICAgdGhpcy5fdHJhbnMgPSAxMDAwLjA7XG4gICAgICAgIHRoaXMuX3NrZXcgPSAwLjA7XG4gICAgfVxuXG4gICAgcmVzdW1lKCkge1xuICAgICAgICB0aGlzLl9waW5nZXIucmVzdW1lKCk7XG4gICAgfVxuXG4gICAgcGF1c2UoKSB7XG4gICAgICAgIHRoaXMuX3Bpbmdlci5wYXVzZSgpO1xuICAgIH1cblxuICAgIF9vbnBpbmcoKSB7XG4gICAgICAgIGNvbnN0IHRzMCA9IENMT0NLLm5vdygpO1xuICAgICAgICB0aGlzLl9kY2NsaWVudC5nZXQoXCIvY2xvY2tcIikudGhlbigoe2RhdGF9KSA9PiB7XG4gICAgICAgICAgICBjb25zdCB0czEgPSBDTE9DSy5ub3coKTtcbiAgICAgICAgICAgIHRoaXMuX2FkZF9zYW1wbGUodHMwLCBkYXRhLCB0czEpO1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfYWRkX3NhbXBsZShjcywgc3MsIGNyKSB7XG4gICAgICAgIGxldCB0cmFucyA9IChjciAtIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNrZXcgPSBzcyAtIChjciArIGNzKSAvIDIuMDtcbiAgICAgICAgbGV0IHNhbXBsZSA9IFtjcywgc3MsIGNyLCB0cmFucywgc2tld107XG4gICAgICAgIC8vIGFkZCB0byBzYW1wbGVzXG4gICAgICAgIHRoaXMuX3NhbXBsZXMucHVzaChzYW1wbGUpXG4gICAgICAgIGlmICh0aGlzLl9zYW1wbGVzLmxlbmd0aCA+IE1BWF9TQU1QTEVfQ09VTlQpIHtcbiAgICAgICAgICAgIC8vIHJlbW92ZSBmaXJzdCBzYW1wbGVcbiAgICAgICAgICAgIHRoaXMuX3NhbXBsZXMuc2hpZnQoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZWV2YWx1YXRlIGVzdGltYXRlcyBmb3Igc2tldyBhbmQgdHJhbnNcbiAgICAgICAgdHJhbnMgPSAxMDAwMDAuMDtcbiAgICAgICAgc2tldyA9IDAuMDtcbiAgICAgICAgZm9yIChjb25zdCBzYW1wbGUgb2YgdGhpcy5fc2FtcGxlcykge1xuICAgICAgICAgICAgaWYgKHNhbXBsZVszXSA8IHRyYW5zKSB7XG4gICAgICAgICAgICAgICAgdHJhbnMgPSBzYW1wbGVbM107XG4gICAgICAgICAgICAgICAgc2tldyA9IHNhbXBsZVs0XTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9za2V3ID0gc2tldztcbiAgICAgICAgdGhpcy5fdHJhbnMgPSB0cmFucztcbiAgICB9XG5cbiAgICBnZXQgc2tldygpIHtyZXR1cm4gdGhpcy5fc2tldzt9XG4gICAgZ2V0IHRyYW5zKCkge3JldHVybiB0aGlzLl90cmFuczt9XG5cbiAgICBub3coKSB7XG4gICAgICAgIC8vIHNlcnZlciBjbG9jayBpcyBsb2NhbCBjbG9jayArIGVzdGltYXRlZCBza2V3XG4gICAgICAgIHJldHVybiBDTE9DSy5ub3coKSArIHRoaXMuX3NrZXc7XG4gICAgfVxuXG59XG5cblxuLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgIFBJTkdFUlxuKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuLyoqXG4gKiBQaW5nZXIgaW52b2tlcyBhIGNhbGxiYWNrIHJlcGVhdGVkbHksIGluZGVmaW5pdGVseS4gXG4gKiBQaW5naW5nIGluIDMgc3RhZ2VzLCBmaXJzdCBmcmVxdWVudGx5LCB0aGVuIG1vZGVyYXRlbHksIFxuICogdGhlbiBzbG93bHkuXG4gKi9cblxuY29uc3QgU1dJVENIX01FRElVTSA9IDM7IC8vIGNvdW50XG5jb25zdCBTV0lUQ0hfTEFSR0UgPSAxMDsgLy8gY291bnRcbmNvbnN0IFNNQUxMX0RFTFRBID0gMjA7IC8vIG1zXG5jb25zdCBNRURJVU1fREVMVEEgPSA1MDA7IC8vIG1zXG5jb25zdCBMQVJHRV9ERUxUQSA9IDEwMDAwOyAvLyBtc1xuXG5jbGFzcyBQaW5nZXIge1xuXG4gICAgY29uc3RydWN0b3IgKGNhbGxiYWNrKSB7XG4gICAgICAgIHRoaXMuX2NvdW50ID0gMDtcbiAgICAgICAgdGhpcy5fdGlkID0gdW5kZWZpbmVkO1xuICAgICAgICB0aGlzLl9jYWxsYmFjayA9IGNhbGxiYWNrO1xuICAgICAgICB0aGlzLl9waW5nID0gdGhpcy5waW5nLmJpbmQodGhpcylcbiAgICB9XG4gICAgcGF1c2UoKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgIH1cbiAgICByZXN1bWUoKSB7XG4gICAgICAgIGNsZWFyVGltZW91dCh0aGlzLl90aWQpO1xuICAgICAgICB0aGlzLnBpbmcoKTtcbiAgICB9XG4gICAgcmVzdGFydCgpIHtcbiAgICAgICAgdGhpcy5fY291bnQgPSAwO1xuICAgICAgICBjbGVhclRpbWVvdXQodGhpcy5fdGlkKTtcbiAgICAgICAgdGhpcy5waW5nKCk7XG4gICAgfVxuICAgIHBpbmcgKCkge1xuICAgICAgICB0aGlzLl9jb3VudCArPSAxO1xuICAgICAgICBpZiAodGhpcy5fY291bnQgPCBTV0lUQ0hfTUVESVVNKSB7XG4gICAgICAgICAgICB0aGlzLl90aWQgPSBzZXRUaW1lb3V0KHRoaXMuX3BpbmcsIFNNQUxMX0RFTFRBKTtcbiAgICAgICAgfSBlbHNlIGlmICh0aGlzLl9jb3VudCA8IFNXSVRDSF9MQVJHRSkge1xuICAgICAgICAgICAgdGhpcy5fdGlkID0gc2V0VGltZW91dCh0aGlzLl9waW5nLCBNRURJVU1fREVMVEEpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fdGlkID0gc2V0VGltZW91dCh0aGlzLl9waW5nLCBMQVJHRV9ERUxUQSk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2NhbGxiYWNrKSB7XG4gICAgICAgICAgICB0aGlzLl9jYWxsYmFjaygpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5cbiIsImltcG9ydCB7IFdlYlNvY2tldElPIH0gZnJvbSBcIi4vd3Npby5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5pbXBvcnQgeyBEYXRhc2V0IH0gZnJvbSBcIi4vZGF0YXNldC5qc1wiO1xuaW1wb3J0IHsgU2VydmVyQ2xvY2sgfSBmcm9tIFwiLi9jbG9jay5qc1wiO1xuXG5jb25zdCBNc2dUeXBlID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgTUVTU0FHRSA6IFwiTUVTU0FHRVwiLFxuICAgIFJFUVVFU1Q6IFwiUkVRVUVTVFwiLFxuICAgIFJFUExZOiBcIlJFUExZXCJcbiB9KTtcbiBcbmNvbnN0IE1zZ0NtZCA9IE9iamVjdC5mcmVlemUoe1xuICAgIEdFVCA6IFwiR0VUXCIsXG4gICAgUFVUOiBcIlBVVFwiLFxuICAgIE5PVElGWTogXCJOT1RJRllcIlxufSk7XG5cblxuZXhwb3J0IGNsYXNzIERhdGFDYW5ub24gZXh0ZW5kcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3RvciAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKHVybCwgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gcmVxdWVzdHNcbiAgICAgICAgdGhpcy5fcmVxaWQgPSAwO1xuICAgICAgICB0aGlzLl9wZW5kaW5nID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgLy8gcGF0aCAtPiB7fSBcbiAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gZGF0YXNldHNcbiAgICAgICAgLy8gcGF0aCAtPiBkc1xuICAgICAgICB0aGlzLl9kc19tYXAgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMuX2RzX2hhbmRsZV9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gY2xvY2tcbiAgICAgICAgdGhpcy5fY2xvY2sgPSBuZXcgU2VydmVyQ2xvY2sodGhpcyk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBDT05ORUNUSU9OIFxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIC8vIGFjdGl2YXRlIHNlcnZlciBjbG9ja1xuICAgICAgICB0aGlzLl9jbG9jay5yZXN1bWUoKTtcblxuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gcmVmcmVzaCBsb2NhbCBzdXNjcmlwdGlvbnNcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdCgpIHtcbiAgICAgICAgdGhpcy5fY2xvY2sucGF1c2UoKTtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbW11bmljYXRpb24gRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgSEFORExFUlNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgbGV0IG1zZyA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLlJFUExZKSB7XG4gICAgICAgICAgICBsZXQgcmVxaWQgPSBtc2cudHVubmVsO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmcuaGFzKHJlcWlkKSkge1xuICAgICAgICAgICAgICAgIGxldCByZXNvbHZlciA9IHRoaXMuX3BlbmRpbmcuZ2V0KHJlcWlkKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nLmRlbGV0ZShyZXFpZCk7XG4gICAgICAgICAgICAgICAgY29uc3Qge29rLCBkYXRhfSA9IG1zZztcbiAgICAgICAgICAgICAgICByZXNvbHZlcih7b2ssIGRhdGF9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLk1FU1NBR0UpIHtcbiAgICAgICAgICAgIGlmIChtc2cuY21kID09IE1zZ0NtZC5OT1RJRlkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVfbm90aWZ5KG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX25vdGlmeShtc2cpIHtcbiAgICAgICAgLy8gdXBkYXRlIGRhdGFzZXQgc3RhdGVcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9kc19tYXAuZ2V0KG1zZ1tcInBhdGhcIl0pO1xuICAgICAgICBpZiAoZHMgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkcy5fZGNjbGllbnRfdXBkYXRlKG1zZ1tcImRhdGFcIl0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBTRVJWRVIgUkVRVUVTVFNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBfcmVxdWVzdChjbWQsIHBhdGgsIGFyZykge1xuICAgICAgICBjb25zdCByZXFpZCA9IHRoaXMuX3JlcWlkKys7XG4gICAgICAgIGNvbnN0IG1zZyA9IHtcbiAgICAgICAgICAgIHR5cGU6IE1zZ1R5cGUuUkVRVUVTVCxcbiAgICAgICAgICAgIGNtZCwgXG4gICAgICAgICAgICBwYXRoLCBcbiAgICAgICAgICAgIGFyZyxcbiAgICAgICAgICAgIHR1bm5lbDogcmVxaWRcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5zZW5kKEpTT04uc3RyaW5naWZ5KG1zZykpO1xuICAgICAgICBsZXQgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcuc2V0KHJlcWlkLCByZXNvbHZlcik7XG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIC8vIHNwZWNpYWwgaGFuZGxpbmcgZm9yIHJlcGxpZXMgdG8gUFVUIC9zdWJzXG4gICAgICAgICAgICBpZiAoY21kID09IE1zZ0NtZC5QVVQgJiYgcGF0aCA9PSBcIi9zdWJzXCIgJiYgb2spIHtcbiAgICAgICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3Vic2NyaXB0aW9uIHN0YXRlXG4gICAgICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKGRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge29rLCBwYXRoLCBkYXRhfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3N1YiAocGF0aCkge1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgICAgICAvLyBzZXQgbmV3IHBhdGhcbiAgICAgICAgICAgIHN1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzIC0gc3Vic2NyaWJlIG9uIHJlY29ubmVjdFxuICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe29rOiB0cnVlLCBwYXRoLCBkYXRhOnVuZGVmaW5lZH0pXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIF91bnN1YiAocGF0aCkge1xuICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgIC8vIHJlbW92ZSBwYXRoXG4gICAgICAgIHN1YnNfbWFwLmRlbGV0ZShwYXRoKVxuICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi5zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBnZXQocGF0aCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuR0VULCBwYXRoKTtcbiAgICB9XG4gICAgXG4gICAgdXBkYXRlKHBhdGgsIGNoYW5nZXMpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLlBVVCwgcGF0aCwgY2hhbmdlcyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYWNxdWlyZSBkYXRhc2V0IGZvciBwYXRoXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHN1YnNjcmliZXMgdG8gcGF0aCBpZiBuZWVkZWRcbiAgICAgKiByZXR1cm5zIGhhbmRsZSBhbmQgZGF0YXNldFxuICAgICAqIGhhbmRsZSB1c2VkIHRvIHJlbGVhc2UgZGF0YXNldFxuICAgICAqL1xuXG4gICAgYWNxdWlyZSAocGF0aCkge1xuICAgICAgICAvLyBzdWJzY3JpYmUgaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgLy8gc3Vic2NyaWJlIHRvIHBhdGhcbiAgICAgICAgICAgIHRoaXMuX3N1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgZGF0YXNldCBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fZHNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fZHNfbWFwLnNldChwYXRoLCBuZXcgRGF0YXNldCh0aGlzLCBwYXRoKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9kc19tYXAuZ2V0KHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgaGFuZGxlIGZvciBwYXRoXG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtwYXRofTtcbiAgICAgICAgaWYgKCF0aGlzLl9kc19oYW5kbGVfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fZHNfaGFuZGxlX21hcC5zZXQocGF0aCwgW10pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2RzX2hhbmRsZV9tYXAuZ2V0KHBhdGgpLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIFtoYW5kbGUsIGRzXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiByZWxlYXNlIGRhdGFzZXQgYnkgaGFuZGxlXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHVuc3Vic2NyaWJlIGlmIGFsbCBoYW5kbGVzIGhhdmUgYmVlbiByZWxlYXNlZFxuICAgICAqL1xuXG4gICAgcmVsZWFzZSAoaGFuZGxlKSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBoYW5kbGUucGF0aDtcbiAgICAgICAgY29uc3QgaGFuZGxlcyA9IHRoaXMuX2RzX2hhbmRsZV9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAoaGFuZGxlcyA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyByZW1vdmUgaGFuZGxlXG4gICAgICAgIGNvbnN0IGluZGV4ID0gaGFuZGxlcy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICBoYW5kbGVzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY2xlYW4gdXAgaWYgbGFzdCBoYW5kbGUgcmVsZWFzZWRcbiAgICAgICAgaWYgKGhhbmRsZXMubGVuZ3RoID09IDApIHtcbiAgICAgICAgICAgIHRoaXMuX3Vuc3ViKHBhdGgpO1xuICAgICAgICAgICAgLy8gY2xlYXIvZGlzYWJsZSBkYXRhc2V0XG4gICAgICAgICAgICAvLyBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQocGF0aCk7XG4gICAgICAgICAgICB0aGlzLl9kc19tYXAuZGVsZXRlKHBhdGgpO1xuICAgICAgICB9XG4gICAgfVxuXG5cbiAgICAvKipcbiAgICAgKiBzZXJ2ZXIgY2xvY2tcbiAgICAgKi9cbiAgICBnZXQgY2xvY2sgKCkge1xuICAgICAgICByZXR1cm4gdGhpcy5fY2xvY2s7XG4gICAgfVxuXG59XG5cblxuIiwiLypcbiAgICBEYXRhc2V0IFZpZXdlclxuKi9cblxuZnVuY3Rpb24gaXRlbTJzdHJpbmcoaXRlbSkge1xuICAgIGNvbnN0IHtpZCwgaXR2LCBkYXRhfSA9IGl0ZW07XG4gICAgbGV0IGRhdGFfdHh0ID0gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgbGV0IGl0dl90eHQgPSAoaXR2ICE9IHVuZGVmaW5lZCkgPyBKU09OLnN0cmluZ2lmeShpdHYpIDogXCJcIjtcbiAgICBsZXQgaWRfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImlkXCI+JHtpZH08L3NwYW4+YDtcbiAgICBsZXQgaXR2X2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpdHZcIj4ke2l0dl90eHR9PC9zcGFuPmA7XG4gICAgbGV0IGRhdGFfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImRhdGFcIj4ke2RhdGFfdHh0fTwvc3Bhbj5gO1xuICAgIHJldHVybiBgXG4gICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8YnV0dG9uIGlkPVwiZGVsZXRlXCI+WDwvYnV0dG9uPlxuICAgICAgICAgICAgJHtpZF9odG1sfTogJHtpdHZfaHRtbH0gJHtkYXRhX2h0bWx9XG4gICAgICAgIDwvZGl2PmA7XG59XG5cblxuZXhwb3J0IGNsYXNzIERhdGFzZXRWaWV3ZXIge1xuXG4gICAgY29uc3RydWN0b3IoZGF0YXNldCwgZWxlbSwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl9kcyA9IGRhdGFzZXQ7XG4gICAgICAgIHRoaXMuX2VsZW0gPSBlbGVtO1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB0aGlzLl9kcy5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7IFxuXG4gICAgICAgIC8vIG9wdGlvbnNcbiAgICAgICAgbGV0IGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgZGVsZXRlOmZhbHNlLFxuICAgICAgICAgICAgdG9TdHJpbmc6aXRlbTJzdHJpbmdcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHsuLi5kZWZhdWx0cywgLi4ub3B0aW9uc307XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIFN1cHBvcnQgZGVsZXRlXG4gICAgICAgICovXG4gICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmRlbGV0ZSkge1xuICAgICAgICAgICAgLy8gbGlzdGVuIGZvciBjbGljayBldmVudHMgb24gcm9vdCBlbGVtZW50XG4gICAgICAgICAgICBlbGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhdGNoIGNsaWNrIGV2ZW50IGZyb20gZGVsZXRlIGJ1dHRvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGUudGFyZ2V0LmNsb3Nlc3QoXCIjZGVsZXRlXCIpO1xuICAgICAgICAgICAgICAgIGlmIChkZWxldGVCdG4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdEl0ZW0gPSBkZWxldGVCdG4uY2xvc2VzdChcIi5saXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fZHMudXBkYXRlKHtyZW1vdmU6W2xpc3RJdGVtLmlkXX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGNvbnN0IHt0b1N0cmluZ30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBmb3IgKGxldCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5uZXcpIHtcbiAgICAgICAgICAgICAgICAvLyBhZGRcbiAgICAgICAgICAgICAgICBsZXQgbm9kZSA9IHRoaXMuX2VsZW0ucXVlcnlTZWxlY3RvcihgIyR7ZGlmZi5pZH1gKTtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZShcImlkXCIsIGRpZmYuaWQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNsYXNzTGlzdC5hZGQoXCJsaXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VsZW0uYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5vZGUuaW5uZXJIVE1MID0gdG9TdHJpbmcoZGlmZi5uZXcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkaWZmLm9sZCkge1xuICAgICAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4i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QVksT0FBTyxPQUFPLENBQUMsT0FBTyxDQUFDLENBQUMsRUFBRSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztJQUNuRTs7SUFFQTs7SUFFQSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRTtJQUNsQjtJQUNBLFFBQVEsTUFBTSxRQUFRLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNyRDtJQUNBLFFBQVEsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJO0lBQzVCO0lBQ0EsUUFBUSxNQUFNLEtBQUssR0FBRyxDQUFDLEdBQUcsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQzdDLFFBQVEsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9EOztJQUVBO0lBQ0E7SUFDQTs7SUFFQSxJQUFJLEdBQUcsQ0FBQyxJQUFJLEVBQUU7SUFDZCxRQUFRLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLElBQUksQ0FBQztJQUM5QztJQUNBO0lBQ0EsSUFBSSxNQUFNLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRTtJQUMxQixRQUFRLE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLENBQUMsR0FBRyxFQUFFLElBQUksRUFBRSxPQUFPLENBQUM7SUFDdkQ7O0lBRUE7SUFDQTtJQUNBO0lBQ0E7SUFDQTtJQUNBOztJQUVBLElBQUksT0FBTyxDQUFDLENBQUMsSUFBSSxFQUFFO0lBQ25CO0lBQ0EsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7SUFDdkM7SUFDQSxZQUFZLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQzNCO0lBQ0E7SUFDQSxRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFD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
