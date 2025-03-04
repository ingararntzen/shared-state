
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
         * server reset dataset 
         */
        _dcclient_reset(insert_items) {
            // prepare diffs with oldstate
            const diff_map = new Map();
            for (const item of this._map.values()) {
                diff_map.set(
                    item.id, 
                    {id: item.id, new:undefined, old:item}
                );
            }
            // reset state and build diff map
            this._map = new Map();
            for (const item of insert_items) {
                this._map.set(item.id, item);
                if (diff_map.has(item.id)) {
                    diff_map.get(item.id).new = item;                
                } else {
                    diff_map.set(item.id, {id:item.id, new: item, old:undefined});
                }
            }
            this._dcclient_notify_callbacks([...diff_map.values()]);
        }

        /**
         * server update dataset 
         */
        _dcclient_update (remove_ids, insert_items) {
            const diff_map = new Map();

            // remove
            for (const _id of remove_ids) {
                const old = this._msg.get(_id);
                if (old != undefined) {
                    this._msg.delete(_id);
                    diff_map.set(_id, {id:_id, new:undefined, old});
                }
            }

            // insert
            for (const item of insert_items) {
                const _id = item.id;
                // old from diff_map or _map
                const diff = diff_map.get(_id);
                const old = (diff != undefined) ? diff.old : this._map.get(_id);
                // set state
                this._map.set(_id, item);
                // update diff map
                diff_map.set(_id, {id:_id, new:item, old});
            }
            this._dcclient_notify_callbacks([...diff_map.values()]);
        }

        _dcclient_notify_callbacks (eArg) {
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
            let {
                insert=[],
                remove=[],
                clear=false
            } = changes;
            if (clear) {
                return this._dcclient.reset(this._path, insert);
            } else {
                return this._dcclient.update(this._path, remove, insert);
            }
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

    const MsgType = Object.freeze({
        MESSAGE : "MESSAGE",
        REQUEST: "REQUEST",
        REPLY: "REPLY"
     });
     
    const MsgCmd = Object.freeze({
        GET : "GET",
        PUT: "PUT",
        DELETE: "DELETE",
        RESET: "RESET",
        NOTIFY: "NOTIFY"
    });


    class DataCannonClient extends WebSocketIO {

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
        }

        /*********************************************************************
            CONNECTION 
        *********************************************************************/

        on_connect() {
            console.log(`Connect  ${this.url}`);
            // refresh local suscriptions
            if (this._subs_map.size > 0) {
                this.reset("/subs", [...this._subs_map.entries()]);
            }
        }
        on_disconnect() {
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
                if (msg.cmd == MsgCmd.RESET) {
                    this._handle_reset(msg);
                } else if (msg.cmd == MsgCmd.NOTIFY) {
                    this._handle_notify(msg);
                }
            }
        }

        _handle_reset(msg) {
            // set dataset state
            const ds = this._ds_map.get(msg["path"]);
            if (ds != undefined) {
                ds._dcclient_reset(msg["data"]);
            }
        }

        _handle_notify(msg) {
            // update dataset state
            const ds = this._ds_map.get(msg["path"]);
            if (ds != undefined) {
                const [remove, insert] = msg["data"];
                ds._dcclient_update(remove, insert);
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
                return this.reset("/subs", [...subs_map.entries()]);
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
            return this.reset("/subs", [...subs_map.entries()]);
        }

        /*********************************************************************
            API
        *********************************************************************/

        get(path) {
            return this._request(MsgCmd.GET, path);
        }
        
        reset(path, insert) {
            const arg= {method:"reset", args:insert};
            return this._request(MsgCmd.PUT, path, arg);
        }

        update(path, remove, insert) {
            const arg = {method:"update", args:[remove, insert]};
            return this._request(MsgCmd.PUT, path, arg);
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

    exports.DataCannonClient = DataCannonClient;
    exports.DatasetViewer = DatasetViewer;

    return exports;

})({});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YWNhbm5vbi5paWZlLmpzIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY2xpZW50L3V0aWwuanMiLCIuLi8uLi9zcmMvY2xpZW50L3dzaW8uanMiLCIuLi8uLi9zcmMvY2xpZW50L2RhdGFzZXQuanMiLCIuLi8uLi9zcmMvY2xpZW50L2RhdGFjYW5ub24uanMiLCIuLi8uLi9zcmMvY2xpZW50L3ZpZXdlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICAgIENyZWF0ZSBhIHByb21pc2Ugd2hpY2ggY2FuIGJlIHJlc29sdmVkXG4gICAgcHJvZ3JhbW1hdGljYWxseSBieSBleHRlcm5hbCBjb2RlLlxuICAgIFJldHVybiBhIHByb21pc2UgYW5kIGEgcmVzb2x2ZSBmdW5jdGlvblxuKi9cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmFibGVQcm9taXNlKCkge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcmVzb2x2ZXIgPSByZXNvbHZlO1xuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZW91dFByb21pc2UgKG1zKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBsZXQgdGlkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9LCBtcyk7XG4gICAgICAgIHJlc29sdmVyID0gKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRpZCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzb2x2ZShmYWxzZSk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn0iLCJpbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuY29uc3QgTUFYX1JFVFJJRVMgPSA0O1xuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IodXJsLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3VybCA9IHVybDtcbiAgICAgICAgdGhpcy5fd3M7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgIH1cblxuICAgIGdldCBjb25uZWN0aW5nKCkge3JldHVybiB0aGlzLl9jb25uZWN0aW5nO31cbiAgICBnZXQgY29ubmVjdGVkKCkge3JldHVybiB0aGlzLl9jb25uZWN0ZWQ7fVxuICAgIGdldCB1cmwoKSB7cmV0dXJuIHRoaXMuX3VybDt9XG4gICAgZ2V0IG9wdGlvbnMoKSB7cmV0dXJuIHRoaXMuX29wdGlvbnM7fVxuXG4gICAgY29ubmVjdCgpIHtcblxuICAgICAgICBpZiAodGhpcy5jb25uZWN0aW5nIHx8IHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkNvbm5lY3Qgd2hpbGUgY29ubmVjdGluZyBvciBjb25uZWN0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2lzX3Rlcm1pbmF0ZWQoKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJUZXJtaW5hdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gY29ubmVjdGluZ1xuICAgICAgICB0aGlzLl93cyA9IG5ldyBXZWJTb2NrZXQodGhpcy5fdXJsKTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuX3dzLm9ub3BlbiA9IGUgPT4gdGhpcy5fb25fb3BlbihlKTtcbiAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gZSA9PiB0aGlzLm9uX21lc3NhZ2UoZS5kYXRhKTtcbiAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IGUgPT4gdGhpcy5fb25fY2xvc2UoZSk7XG4gICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSBlID0+IHRoaXMub25fZXJyb3IoZSk7XG4gICAgICAgIHRoaXMub25fY29ubmVjdGluZygpO1xuICAgIH1cblxuICAgIF9vbl9vcGVuKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gcmVsZWFzZSBjb25uZWN0IHByb21pc2VzXG4gICAgICAgIGZvciAoY29uc3QgcmVzb2x2ZXIgb2YgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycykge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgICAgIC8vIHJlc2V0IHJldHJpZXMgb24gc3VjY2Vzc2Z1bCBjb25uZWN0aW9uXG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3QoKTtcbiAgICB9XG5cbiAgICBfb25fY2xvc2UoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5vbl9kaXNjb25uZWN0KGV2ZW50KTtcbiAgICAgICAgdGhpcy5fcmV0cmllcyArPSAxO1xuICAgICAgICBpZiAoIXRoaXMuX2lzX3Rlcm1pbmF0ZWQoKSkge1xuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0KCk7XG4gICAgICAgICAgICB9LCAxMDAwICogdGhpcy5fcmV0cmllcyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgX2lzX3Rlcm1pbmF0ZWQoKSB7XG4gICAgICAgIGNvbnN0IHtyZXRyaWVzPU1BWF9SRVRSSUVTfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmICh0aGlzLl9yZXRyaWVzID49IHJldHJpZXMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBUZXJtaW5hdGVkOiBNYXggcmV0cmllcyByZWFjaGVkICgke3JldHJpZXN9KWApO1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9ub3BlbiA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3MgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgb25fY29ubmVjdGluZygpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBDb25uZWN0aW5nICR7dGhpcy51cmx9YCk7fVxuICAgIH1cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fZXJyb3IoZXJyb3IpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuICAgIG9uX2Rpc2Nvbm5lY3QoZXZlbnQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBSZWNlaXZlOiAke2RhdGF9YCk7fVxuICAgIH1cblxuICAgIHNlbmQoZGF0YSkge1xuICAgICAgICBpZiAodGhpcy5fY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3dzLnNlbmQoZGF0YSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFNlbmQgZmFpbDogJHtlcnJvcn1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZW5kIGRyb3AgOiBub3QgY29ubmVjdGVkYClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbm5lY3RlZFByb21pc2UoKSB7XG4gICAgICAgIGNvbnN0IFtwcm9taXNlLCByZXNvbHZlcl0gPSByZXNvbHZhYmxlUHJvbWlzZSgpO1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzLnB1c2gocmVzb2x2ZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgIH1cbn1cblxuXG4iLCJcblxuZXhwb3J0IGNsYXNzIERhdGFzZXQge1xuXG4gICAgY29uc3RydWN0b3IoZGNjbGllbnQsIHBhdGgpIHtcbiAgICAgICAgLy8gZGNjbGllbnRcbiAgICAgICAgdGhpcy5fZGNjbGllbnQgPSBkY2NsaWVudDtcbiAgICAgICAgdGhpcy5fcGF0aCA9IHBhdGg7XG4gICAgICAgIC8vIGNhbGxiYWNrc1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgICAgICAvLyBpdGVtc1xuICAgICAgICB0aGlzLl9tYXAgPSBuZXcgTWFwKCk7XG4gICAgfVxuXG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIERDIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHJlc2V0IGRhdGFzZXQgXG4gICAgICovXG4gICAgX2RjY2xpZW50X3Jlc2V0KGluc2VydF9pdGVtcykge1xuICAgICAgICAvLyBwcmVwYXJlIGRpZmZzIHdpdGggb2xkc3RhdGVcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiB0aGlzLl9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIGRpZmZfbWFwLnNldChcbiAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICB7aWQ6IGl0ZW0uaWQsIG5ldzp1bmRlZmluZWQsIG9sZDppdGVtfVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICAvLyByZXNldCBzdGF0ZSBhbmQgYnVpbGQgZGlmZiBtYXBcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaW5zZXJ0X2l0ZW1zKSB7XG4gICAgICAgICAgICB0aGlzLl9tYXAuc2V0KGl0ZW0uaWQsIGl0ZW0pO1xuICAgICAgICAgICAgaWYgKGRpZmZfbWFwLmhhcyhpdGVtLmlkKSkge1xuICAgICAgICAgICAgICAgIGRpZmZfbWFwLmdldChpdGVtLmlkKS5uZXcgPSBpdGVtOyAgICAgICAgICAgICAgICBcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KGl0ZW0uaWQsIHtpZDppdGVtLmlkLCBuZXc6IGl0ZW0sIG9sZDp1bmRlZmluZWR9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9kY2NsaWVudF9ub3RpZnlfY2FsbGJhY2tzKFsuLi5kaWZmX21hcC52YWx1ZXMoKV0pO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHNlcnZlciB1cGRhdGUgZGF0YXNldCBcbiAgICAgKi9cbiAgICBfZGNjbGllbnRfdXBkYXRlIChyZW1vdmVfaWRzLCBpbnNlcnRfaXRlbXMpIHtcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgIGZvciAoY29uc3QgX2lkIG9mIHJlbW92ZV9pZHMpIHtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IHRoaXMuX21zZy5nZXQoX2lkKTtcbiAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5fbXNnLmRlbGV0ZShfaWQpO1xuICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChfaWQsIHtpZDpfaWQsIG5ldzp1bmRlZmluZWQsIG9sZH0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0XG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpbnNlcnRfaXRlbXMpIHtcbiAgICAgICAgICAgIGNvbnN0IF9pZCA9IGl0ZW0uaWQ7XG4gICAgICAgICAgICAvLyBvbGQgZnJvbSBkaWZmX21hcCBvciBfbWFwXG4gICAgICAgICAgICBjb25zdCBkaWZmID0gZGlmZl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICBjb25zdCBvbGQgPSAoZGlmZiAhPSB1bmRlZmluZWQpID8gZGlmZi5vbGQgOiB0aGlzLl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICAvLyBzZXQgc3RhdGVcbiAgICAgICAgICAgIHRoaXMuX21hcC5zZXQoX2lkLCBpdGVtKTtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBkaWZmIG1hcFxuICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3Oml0ZW0sIG9sZH0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2RjY2xpZW50X25vdGlmeV9jYWxsYmFja3MoWy4uLmRpZmZfbWFwLnZhbHVlcygpXSk7XG4gICAgfVxuXG4gICAgX2RjY2xpZW50X25vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUFBMSUNBVElPTiBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVxdWVzdGluZyBpdGVtc1xuICAgICAqL1xuICAgIGdldF9pdGVtcygpIHtcbiAgICAgICAgcmV0dXJuIFsuLi50aGlzLl9tYXAudmFsdWVzKCldO1xuICAgIH07XG5cbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9XG5cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIGRpc3BhdGNoaW5nIHVwZGF0ZSB0byBzZXJ2ZXJcbiAgICAgKi9cbiAgICB1cGRhdGUgKGNoYW5nZXM9e30pIHtcbiAgICAgICAgbGV0IHtcbiAgICAgICAgICAgIGluc2VydD1bXSxcbiAgICAgICAgICAgIHJlbW92ZT1bXSxcbiAgICAgICAgICAgIGNsZWFyPWZhbHNlXG4gICAgICAgIH0gPSBjaGFuZ2VzO1xuICAgICAgICBpZiAoY2xlYXIpIHtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLl9kY2NsaWVudC5yZXNldCh0aGlzLl9wYXRoLCBpbnNlcnQpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMuX2RjY2xpZW50LnVwZGF0ZSh0aGlzLl9wYXRoLCByZW1vdmUsIGluc2VydCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhcHBsaWNhdGlvbiByZWdpc3RlciBjYWxsYmFja1xuICAgICovXG4gICAgYWRkX2NhbGxiYWNrIChoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtoYW5kbGVyfTtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMucHVzaChoYW5kbGUpO1xuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07ICAgIFxuICAgIHJlbW92ZV9jYWxsYmFjayAoaGFuZGxlKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gdGhpcy5faGFuZGxlcnMuaW5kZXhPZihoYW5kbGUpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5faGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgIH07XG4gICAgXG59IiwiaW1wb3J0IHsgV2ViU29ja2V0SU8gfSBmcm9tIFwiLi93c2lvLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IERhdGFzZXQgfSBmcm9tIFwiLi9kYXRhc2V0LmpzXCI7XG5cblxuY29uc3QgTXNnVHlwZSA9IE9iamVjdC5mcmVlemUoe1xuICAgIE1FU1NBR0UgOiBcIk1FU1NBR0VcIixcbiAgICBSRVFVRVNUOiBcIlJFUVVFU1RcIixcbiAgICBSRVBMWTogXCJSRVBMWVwiXG4gfSk7XG4gXG5jb25zdCBNc2dDbWQgPSBPYmplY3QuZnJlZXplKHtcbiAgICBHRVQgOiBcIkdFVFwiLFxuICAgIFBVVDogXCJQVVRcIixcbiAgICBERUxFVEU6IFwiREVMRVRFXCIsXG4gICAgUkVTRVQ6IFwiUkVTRVRcIixcbiAgICBOT1RJRlk6IFwiTk9USUZZXCJcbn0pO1xuXG5cbmV4cG9ydCBjbGFzcyBEYXRhQ2Fubm9uQ2xpZW50IGV4dGVuZHMgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IgKHVybCwgb3B0aW9ucykge1xuICAgICAgICBzdXBlcih1cmwsIG9wdGlvbnMpO1xuXG4gICAgICAgIC8vIHJlcXVlc3RzXG4gICAgICAgIHRoaXMuX3JlcWlkID0gMDtcbiAgICAgICAgdGhpcy5fcGVuZGluZyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBzdWJzY3JpcHRpb25zXG4gICAgICAgIC8vIHBhdGggLT4ge30gXG4gICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIGRhdGFzZXRzXG4gICAgICAgIC8vIHBhdGggLT4gZHNcbiAgICAgICAgdGhpcy5fZHNfbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB0aGlzLl9kc19oYW5kbGVfbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQ09OTkVDVElPTiBcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gcmVmcmVzaCBsb2NhbCBzdXNjcmlwdGlvbnNcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLnNpemUgPiAwKSB7XG4gICAgICAgICAgICB0aGlzLnJlc2V0KFwiL3N1YnNcIiwgWy4uLnRoaXMuX3N1YnNfbWFwLmVudHJpZXMoKV0pXG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbW11bmljYXRpb24gRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgSEFORExFUlNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgbGV0IG1zZyA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLlJFUExZKSB7XG4gICAgICAgICAgICBsZXQgcmVxaWQgPSBtc2cudHVubmVsO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmcuaGFzKHJlcWlkKSkge1xuICAgICAgICAgICAgICAgIGxldCByZXNvbHZlciA9IHRoaXMuX3BlbmRpbmcuZ2V0KHJlcWlkKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nLmRlbGV0ZShyZXFpZCk7XG4gICAgICAgICAgICAgICAgY29uc3Qge29rLCBkYXRhfSA9IG1zZztcbiAgICAgICAgICAgICAgICByZXNvbHZlcih7b2ssIGRhdGF9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLk1FU1NBR0UpIHtcbiAgICAgICAgICAgIGlmIChtc2cuY21kID09IE1zZ0NtZC5SRVNFVCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2hhbmRsZV9yZXNldChtc2cpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChtc2cuY21kID09IE1zZ0NtZC5OT1RJRlkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVfbm90aWZ5KG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX3Jlc2V0KG1zZykge1xuICAgICAgICAvLyBzZXQgZGF0YXNldCBzdGF0ZVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQobXNnW1wicGF0aFwiXSk7XG4gICAgICAgIGlmIChkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRzLl9kY2NsaWVudF9yZXNldChtc2dbXCJkYXRhXCJdKTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9oYW5kbGVfbm90aWZ5KG1zZykge1xuICAgICAgICAvLyB1cGRhdGUgZGF0YXNldCBzdGF0ZVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQobXNnW1wicGF0aFwiXSk7XG4gICAgICAgIGlmIChkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGNvbnN0IFtyZW1vdmUsIGluc2VydF0gPSBtc2dbXCJkYXRhXCJdO1xuICAgICAgICAgICAgZHMuX2RjY2xpZW50X3VwZGF0ZShyZW1vdmUsIGluc2VydCk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNFUlZFUiBSRVFVRVNUU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIF9yZXF1ZXN0KGNtZCwgcGF0aCwgYXJnKSB7XG4gICAgICAgIGNvbnN0IHJlcWlkID0gdGhpcy5fcmVxaWQrKztcbiAgICAgICAgY29uc3QgbXNnID0ge1xuICAgICAgICAgICAgdHlwZTogTXNnVHlwZS5SRVFVRVNULFxuICAgICAgICAgICAgY21kLCBcbiAgICAgICAgICAgIHBhdGgsIFxuICAgICAgICAgICAgYXJnLFxuICAgICAgICAgICAgdHVubmVsOiByZXFpZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlbmQoSlNPTi5zdHJpbmdpZnkobXNnKSk7XG4gICAgICAgIGxldCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgdGhpcy5fcGVuZGluZy5zZXQocmVxaWQsIHJlc29sdmVyKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgLy8gc3BlY2lhbCBoYW5kbGluZyBmb3IgcmVwbGllcyB0byBQVVQgL3N1YnNcbiAgICAgICAgICAgIGlmIChjbWQgPT0gTXNnQ21kLlBVVCAmJiBwYXRoID09IFwiL3N1YnNcIiAmJiBvaykge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzY3JpcHRpb24gc3RhdGVcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoZGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7b2ssIHBhdGgsIGRhdGF9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfc3ViIChwYXRoKSB7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgICAgIC8vIHNldCBuZXcgcGF0aFxuICAgICAgICAgICAgc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5yZXNldChcIi9zdWJzXCIsIFsuLi5zdWJzX21hcC5lbnRyaWVzKCldKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzIC0gc3Vic2NyaWJlIG9uIHJlY29ubmVjdFxuICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe29rOiB0cnVlLCBwYXRoLCBkYXRhOnVuZGVmaW5lZH0pXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIF91bnN1YiAocGF0aCkge1xuICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgIC8vIHJlbW92ZSBwYXRoXG4gICAgICAgIHN1YnNfbWFwLmRlbGV0ZShwYXRoKVxuICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICByZXR1cm4gdGhpcy5yZXNldChcIi9zdWJzXCIsIFsuLi5zdWJzX21hcC5lbnRyaWVzKCldKTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIGdldChwYXRoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5HRVQsIHBhdGgpO1xuICAgIH1cbiAgICBcbiAgICByZXNldChwYXRoLCBpbnNlcnQpIHtcbiAgICAgICAgY29uc3QgYXJnPSB7bWV0aG9kOlwicmVzZXRcIiwgYXJnczppbnNlcnR9O1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuUFVULCBwYXRoLCBhcmcpO1xuICAgIH1cblxuICAgIHVwZGF0ZShwYXRoLCByZW1vdmUsIGluc2VydCkge1xuICAgICAgICBjb25zdCBhcmcgPSB7bWV0aG9kOlwidXBkYXRlXCIsIGFyZ3M6W3JlbW92ZSwgaW5zZXJ0XX07XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5QVVQsIHBhdGgsIGFyZyk7XG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogYWNxdWlyZSBkYXRhc2V0IGZvciBwYXRoXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHN1YnNjcmliZXMgdG8gcGF0aCBpZiBuZWVkZWRcbiAgICAgKiByZXR1cm5zIGhhbmRsZSBhbmQgZGF0YXNldFxuICAgICAqIGhhbmRsZSB1c2VkIHRvIHJlbGVhc2UgZGF0YXNldFxuICAgICAqL1xuXG4gICAgYWNxdWlyZSAocGF0aCkge1xuICAgICAgICAvLyBzdWJzY3JpYmUgaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX3N1YnNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgLy8gc3Vic2NyaWJlIHRvIHBhdGhcbiAgICAgICAgICAgIHRoaXMuX3N1YihwYXRoKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjcmVhdGUgZGF0YXNldCBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fZHNfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fZHNfbWFwLnNldChwYXRoLCBuZXcgRGF0YXNldCh0aGlzLCBwYXRoKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9kc19tYXAuZ2V0KHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgaGFuZGxlIGZvciBwYXRoXG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtwYXRofTtcbiAgICAgICAgaWYgKCF0aGlzLl9kc19oYW5kbGVfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fZHNfaGFuZGxlX21hcC5zZXQocGF0aCwgW10pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2RzX2hhbmRsZV9tYXAuZ2V0KHBhdGgpLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIFtoYW5kbGUsIGRzXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiByZWxlYXNlIGRhdGFzZXQgYnkgaGFuZGxlXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHVuc3Vic2NyaWJlIGlmIGFsbCBoYW5kbGVzIGhhdmUgYmVlbiByZWxlYXNlZFxuICAgICAqL1xuXG4gICAgcmVsZWFzZSAoaGFuZGxlKSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBoYW5kbGUucGF0aDtcbiAgICAgICAgY29uc3QgaGFuZGxlcyA9IHRoaXMuX2RzX2hhbmRsZV9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAoaGFuZGxlcyA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyByZW1vdmUgaGFuZGxlXG4gICAgICAgIGNvbnN0IGluZGV4ID0gaGFuZGxlcy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICBoYW5kbGVzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY2xlYW4gdXAgaWYgbGFzdCBoYW5kbGUgcmVsZWFzZWRcbiAgICAgICAgaWYgKGhhbmRsZXMubGVuZ3RoID09IDApIHtcbiAgICAgICAgICAgIHRoaXMuX3Vuc3ViKHBhdGgpO1xuICAgICAgICAgICAgLy8gY2xlYXIvZGlzYWJsZSBkYXRhc2V0XG4gICAgICAgICAgICAvLyBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQocGF0aCk7XG4gICAgICAgICAgICB0aGlzLl9kc19tYXAuZGVsZXRlKHBhdGgpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5cbiIsIi8qXG4gICAgRGF0YXNldCBWaWV3ZXJcbiovXG5cbmZ1bmN0aW9uIGl0ZW0yc3RyaW5nKGl0ZW0pIHtcbiAgICBjb25zdCB7aWQsIGl0diwgZGF0YX0gPSBpdGVtO1xuICAgIGxldCBkYXRhX3R4dCA9IEpTT04uc3RyaW5naWZ5KGRhdGEpO1xuICAgIGxldCBpdHZfdHh0ID0gKGl0diAhPSB1bmRlZmluZWQpID8gSlNPTi5zdHJpbmdpZnkoaXR2KSA6IFwiXCI7XG4gICAgbGV0IGlkX2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpZFwiPiR7aWR9PC9zcGFuPmA7XG4gICAgbGV0IGl0dl9odG1sID0gYDxzcGFuIGNsYXNzPVwiaXR2XCI+JHtpdHZfdHh0fTwvc3Bhbj5gO1xuICAgIGxldCBkYXRhX2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJkYXRhXCI+JHtkYXRhX3R4dH08L3NwYW4+YDtcbiAgICByZXR1cm4gYFxuICAgICAgICA8ZGl2PlxuICAgICAgICAgICAgPGJ1dHRvbiBpZD1cImRlbGV0ZVwiPlg8L2J1dHRvbj5cbiAgICAgICAgICAgICR7aWRfaHRtbH06ICR7aXR2X2h0bWx9ICR7ZGF0YV9odG1sfVxuICAgICAgICA8L2Rpdj5gO1xufVxuXG5cbmV4cG9ydCBjbGFzcyBEYXRhc2V0Vmlld2VyIHtcblxuICAgIGNvbnN0cnVjdG9yKGRhdGFzZXQsIGVsZW0sIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fZHMgPSBkYXRhc2V0O1xuICAgICAgICB0aGlzLl9lbGVtID0gZWxlbTtcbiAgICAgICAgY29uc3QgaGFuZGxlID0gdGhpcy5fZHMuYWRkX2NhbGxiYWNrKHRoaXMuX29uY2hhbmdlLmJpbmQodGhpcykpOyBcblxuICAgICAgICAvLyBvcHRpb25zXG4gICAgICAgIGxldCBkZWZhdWx0cyA9IHtcbiAgICAgICAgICAgIGRlbGV0ZTpmYWxzZSxcbiAgICAgICAgICAgIHRvU3RyaW5nOml0ZW0yc3RyaW5nXG4gICAgICAgIH07XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSB7Li4uZGVmYXVsdHMsIC4uLm9wdGlvbnN9O1xuXG4gICAgICAgIC8qXG4gICAgICAgICAgICBTdXBwb3J0IGRlbGV0ZVxuICAgICAgICAqL1xuICAgICAgICBpZiAodGhpcy5fb3B0aW9ucy5kZWxldGUpIHtcbiAgICAgICAgICAgIC8vIGxpc3RlbiBmb3IgY2xpY2sgZXZlbnRzIG9uIHJvb3QgZWxlbWVudFxuICAgICAgICAgICAgZWxlbS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGUpID0+IHtcbiAgICAgICAgICAgICAgICAvLyBjYXRjaCBjbGljayBldmVudCBmcm9tIGRlbGV0ZSBidXR0b25cbiAgICAgICAgICAgICAgICBjb25zdCBkZWxldGVCdG4gPSBlLnRhcmdldC5jbG9zZXN0KFwiI2RlbGV0ZVwiKTtcbiAgICAgICAgICAgICAgICBpZiAoZGVsZXRlQnRuKSB7XG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpc3RJdGVtID0gZGVsZXRlQnRuLmNsb3Nlc3QoXCIubGlzdC1pdGVtXCIpO1xuICAgICAgICAgICAgICAgICAgICBpZiAobGlzdEl0ZW0pIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIHRoaXMuX2RzLnVwZGF0ZSh7cmVtb3ZlOltsaXN0SXRlbS5pZF19KTtcbiAgICAgICAgICAgICAgICAgICAgICAgIGUuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9vbmNoYW5nZShkaWZmcykge1xuICAgICAgICBjb25zdCB7dG9TdHJpbmd9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgZm9yIChsZXQgZGlmZiBvZiBkaWZmcykge1xuICAgICAgICAgICAgaWYgKGRpZmYubmV3KSB7XG4gICAgICAgICAgICAgICAgLy8gYWRkXG4gICAgICAgICAgICAgICAgbGV0IG5vZGUgPSB0aGlzLl9lbGVtLnF1ZXJ5U2VsZWN0b3IoYCMke2RpZmYuaWR9YCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUgPT0gbnVsbCkge1xuICAgICAgICAgICAgICAgICAgICBub2RlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudChcImRpdlwiKTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5zZXRBdHRyaWJ1dGUoXCJpZFwiLCBkaWZmLmlkKTtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKFwibGlzdC1pdGVtXCIpO1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9lbGVtLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBub2RlLmlubmVySFRNTCA9IHRvU3RyaW5nKGRpZmYubmV3KTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoZGlmZi5vbGQpIHtcbiAgICAgICAgICAgICAgICAvLyByZW1vdmVcbiAgICAgICAgICAgICAgICBsZXQgbm9kZSA9IHRoaXMuX2VsZW0ucXVlcnlTZWxlY3RvcihgIyR7ZGlmZi5pZH1gKTtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSkge1xuICAgICAgICAgICAgICAgICAgICBub2RlLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQobm9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgfVxufVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7O0lBQUE7SUFDQTtJQUNBO0lBQ0E7SUFDQTs7SUFFTyxTQUFTLGlCQUFpQixHQUFHO0lBQ3BDLElBQUksSUFBSSxRQUFRO0lBQ2hCLElBQUksSUFBSSxPQUFPLEdBQUcsSUFBSSxPQUFPLENBQUMsQ0FBQyxPQUFPLEVBQUUsTUFBTSxLQUFLO0lBQ25ELFFBQVEsUUFBUSxHQUFHLE9BQU87SUFD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
