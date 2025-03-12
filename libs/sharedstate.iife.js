
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

        constructor(ssclient, path) {
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
         * server update dataset 
         */
        _ssclient_update (changes={}) {

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
        get size() {return this._map.size};
        get_item (id) {return this._map.get(id)} 
        has_item(id) {return this._map.has(id)}

        /**
         * application dispatching update to server
         */
        update (changes={}) {
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
                const items = [...this._subs_map.entries()];
                this.update("/subs", {insert:items, reset:true});
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
                if (msg.cmd == MsgCmd.NOTIFY) {
                    this._handle_notify(msg);
                }
            }
        }

        _handle_notify(msg) {
            // update dataset state
            const ds = this._ds_map.get(msg["path"]);
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

    exports.DatasetViewer = DatasetViewer;
    exports.SharedStateClient = SharedStateClient;

    return exports;

})({});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NsaWVudC91dGlsLmpzIiwiLi4vLi4vc3JjL2NsaWVudC93c2lvLmpzIiwiLi4vLi4vc3JjL2NsaWVudC9kYXRhc2V0LmpzIiwiLi4vLi4vc3JjL2NsaWVudC9zc19jbGllbnQuanMiLCIuLi8uLi9zcmMvY2xpZW50L3ZpZXdlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKlxuICAgIENyZWF0ZSBhIHByb21pc2Ugd2hpY2ggY2FuIGJlIHJlc29sdmVkXG4gICAgcHJvZ3JhbW1hdGljYWxseSBieSBleHRlcm5hbCBjb2RlLlxuICAgIFJldHVybiBhIHByb21pc2UgYW5kIGEgcmVzb2x2ZSBmdW5jdGlvblxuKi9cblxuZXhwb3J0IGZ1bmN0aW9uIHJlc29sdmFibGVQcm9taXNlKCkge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgcmVzb2x2ZXIgPSByZXNvbHZlO1xuICAgIH0pO1xuICAgIHJldHVybiBbcHJvbWlzZSwgcmVzb2x2ZXJdO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gdGltZW91dFByb21pc2UgKG1zKSB7XG4gICAgbGV0IHJlc29sdmVyO1xuICAgIGxldCBwcm9taXNlID0gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgICBsZXQgdGlkID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICByZXNvbHZlKHRydWUpO1xuICAgICAgICB9LCBtcyk7XG4gICAgICAgIHJlc29sdmVyID0gKCkgPT4ge1xuICAgICAgICAgICAgaWYgKHRpZCkge1xuICAgICAgICAgICAgICAgIGNsZWFyVGltZW91dCh0aWQpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgcmVzb2x2ZShmYWxzZSk7XG4gICAgICAgIH1cbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn0iLCJpbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuY29uc3QgTUFYX1JFVFJJRVMgPSA0O1xuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IodXJsLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3VybCA9IHVybDtcbiAgICAgICAgdGhpcy5fd3M7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgIH1cblxuICAgIGdldCBjb25uZWN0aW5nKCkge3JldHVybiB0aGlzLl9jb25uZWN0aW5nO31cbiAgICBnZXQgY29ubmVjdGVkKCkge3JldHVybiB0aGlzLl9jb25uZWN0ZWQ7fVxuICAgIGdldCB1cmwoKSB7cmV0dXJuIHRoaXMuX3VybDt9XG4gICAgZ2V0IG9wdGlvbnMoKSB7cmV0dXJuIHRoaXMuX29wdGlvbnM7fVxuXG4gICAgY29ubmVjdCgpIHtcblxuICAgICAgICBpZiAodGhpcy5jb25uZWN0aW5nIHx8IHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhcIkNvbm5lY3Qgd2hpbGUgY29ubmVjdGluZyBvciBjb25uZWN0ZWRcIik7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMuX2lzX3Rlcm1pbmF0ZWQoKSkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJUZXJtaW5hdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gY29ubmVjdGluZ1xuICAgICAgICB0aGlzLl93cyA9IG5ldyBXZWJTb2NrZXQodGhpcy5fdXJsKTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuX3dzLm9ub3BlbiA9IGUgPT4gdGhpcy5fb25fb3BlbihlKTtcbiAgICAgICAgdGhpcy5fd3Mub25tZXNzYWdlID0gZSA9PiB0aGlzLm9uX21lc3NhZ2UoZS5kYXRhKTtcbiAgICAgICAgdGhpcy5fd3Mub25jbG9zZSA9IGUgPT4gdGhpcy5fb25fY2xvc2UoZSk7XG4gICAgICAgIHRoaXMuX3dzLm9uZXJyb3IgPSBlID0+IHRoaXMub25fZXJyb3IoZSk7XG4gICAgICAgIHRoaXMub25fY29ubmVjdGluZygpO1xuICAgIH1cblxuICAgIF9vbl9vcGVuKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gcmVsZWFzZSBjb25uZWN0IHByb21pc2VzXG4gICAgICAgIGZvciAoY29uc3QgcmVzb2x2ZXIgb2YgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycykge1xuICAgICAgICAgICAgcmVzb2x2ZXIoKTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzID0gW107XG4gICAgICAgIC8vIHJlc2V0IHJldHJpZXMgb24gc3VjY2Vzc2Z1bCBjb25uZWN0aW9uXG4gICAgICAgIHRoaXMuX3JldHJpZXMgPSAwO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3QoKTtcbiAgICB9XG5cbiAgICBfb25fY2xvc2UoZXZlbnQpIHtcbiAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9jb25uZWN0ZWQgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5vbl9kaXNjb25uZWN0KGV2ZW50KTtcbiAgICAgICAgdGhpcy5fcmV0cmllcyArPSAxO1xuICAgICAgICBpZiAoIXRoaXMuX2lzX3Rlcm1pbmF0ZWQoKSkge1xuICAgICAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgICAgICAgdGhpcy5jb25uZWN0KCk7XG4gICAgICAgICAgICB9LCAxMDAwICogdGhpcy5fcmV0cmllcyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgX2lzX3Rlcm1pbmF0ZWQoKSB7XG4gICAgICAgIGNvbnN0IHtyZXRyaWVzPU1BWF9SRVRSSUVTfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmICh0aGlzLl9yZXRyaWVzID49IHJldHJpZXMpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBUZXJtaW5hdGVkOiBNYXggcmV0cmllcyByZWFjaGVkICgke3JldHJpZXN9KWApO1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGluZyA9IGZhbHNlO1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gdHJ1ZTtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9ub3BlbiA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3MgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgb25fY29ubmVjdGluZygpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBDb25uZWN0aW5nICR7dGhpcy51cmx9YCk7fVxuICAgIH1cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fZXJyb3IoZXJyb3IpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuICAgIG9uX2Rpc2Nvbm5lY3QoZXZlbnQpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgY29uc3Qge2RlYnVnPWZhbHNlfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGlmIChkZWJ1Zykge2NvbnNvbGUubG9nKGBSZWNlaXZlOiAke2RhdGF9YCk7fVxuICAgIH1cblxuICAgIHNlbmQoZGF0YSkge1xuICAgICAgICBpZiAodGhpcy5fY29ubmVjdGVkKSB7XG4gICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIHRoaXMuX3dzLnNlbmQoZGF0YSk7XG4gICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFNlbmQgZmFpbDogJHtlcnJvcn1gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBTZW5kIGRyb3AgOiBub3QgY29ubmVjdGVkYClcbiAgICAgICAgfVxuICAgIH1cblxuICAgIGNvbm5lY3RlZFByb21pc2UoKSB7XG4gICAgICAgIGNvbnN0IFtwcm9taXNlLCByZXNvbHZlcl0gPSByZXNvbHZhYmxlUHJvbWlzZSgpO1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICB0aGlzLl9jb25uZWN0X3Byb21pc2VfcmVzb2x2ZXJzLnB1c2gocmVzb2x2ZXIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBwcm9taXNlO1xuICAgIH1cbn1cblxuXG4iLCJcblxuZXhwb3J0IGNsYXNzIERhdGFzZXQge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgpIHtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBkYXRhc2V0IFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBjb25zdCB7cmVtb3ZlLCBpbnNlcnQsIHJlc2V0PWZhbHNlfSA9IGNoYW5nZXM7XG4gICAgICAgIGNvbnN0IGRpZmZfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHJlbW92ZSBpdGVtcyAtIGNyZWF0ZSBkaWZmXG4gICAgICAgIGlmIChyZXNldCkge1xuICAgICAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIHRoaXMuX21hcC52YWx1ZXMoKSkge1xuICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChcbiAgICAgICAgICAgICAgICAgICAgaXRlbS5pZCwgXG4gICAgICAgICAgICAgICAgICAgIHtpZDogaXRlbS5pZCwgbmV3OnVuZGVmaW5lZCwgb2xkOml0ZW19XG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHRoaXMuX21hcCA9IG5ldyBNYXAoKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGZvciAoY29uc3QgX2lkIG9mIHJlbW92ZSkge1xuICAgICAgICAgICAgICAgIGNvbnN0IG9sZCA9IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgICAgICBpZiAob2xkICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgICAgICAgICB0aGlzLl9tYXAuZGVsZXRlKF9pZCk7XG4gICAgICAgICAgICAgICAgICAgIGRpZmZfbWFwLnNldChfaWQsIHtpZDpfaWQsIG5ldzp1bmRlZmluZWQsIG9sZH0pO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGluc2VydCBpdGVtcyAtIHVwZGF0ZSBkaWZmXG4gICAgICAgIGZvciAoY29uc3QgaXRlbSBvZiBpbnNlcnQpIHtcbiAgICAgICAgICAgIGNvbnN0IF9pZCA9IGl0ZW0uaWQ7XG4gICAgICAgICAgICAvLyBvbGQgZnJvbSBkaWZmX21hcCBvciBfbWFwXG4gICAgICAgICAgICBjb25zdCBkaWZmID0gZGlmZl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICBjb25zdCBvbGQgPSAoZGlmZiAhPSB1bmRlZmluZWQpID8gZGlmZi5vbGQgOiB0aGlzLl9tYXAuZ2V0KF9pZCk7XG4gICAgICAgICAgICAvLyBzZXQgc3RhdGVcbiAgICAgICAgICAgIHRoaXMuX21hcC5zZXQoX2lkLCBpdGVtKTtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBkaWZmIG1hcFxuICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3Oml0ZW0sIG9sZH0pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX25vdGlmeV9jYWxsYmFja3MoWy4uLmRpZmZfbWFwLnZhbHVlcygpXSk7XG4gICAgfVxuXG4gICAgX25vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUFBMSUNBVElPTiBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gcmVxdWVzdGluZyBpdGVtc1xuICAgICAqL1xuICAgIGdldF9pdGVtcygpIHtcbiAgICAgICAgcmV0dXJuIFsuLi50aGlzLl9tYXAudmFsdWVzKCldO1xuICAgIH07XG4gICAgZ2V0IHNpemUoKSB7cmV0dXJuIHRoaXMuX21hcC5zaXplfTtcbiAgICBnZXRfaXRlbSAoaWQpIHtyZXR1cm4gdGhpcy5fbWFwLmdldChpZCl9IFxuICAgIGhhc19pdGVtKGlkKSB7cmV0dXJuIHRoaXMuX21hcC5oYXMoaWQpfVxuXG4gICAgLyoqXG4gICAgICogYXBwbGljYXRpb24gZGlzcGF0Y2hpbmcgdXBkYXRlIHRvIHNlcnZlclxuICAgICAqL1xuICAgIHVwZGF0ZSAoY2hhbmdlcz17fSkge1xuICAgICAgICByZXR1cm4gdGhpcy5fc3NjbGllbnQudXBkYXRlKHRoaXMuX3BhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFwcGxpY2F0aW9uIHJlZ2lzdGVyIGNhbGxiYWNrXG4gICAgKi9cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTsgICAgXG4gICAgcmVtb3ZlX2NhbGxiYWNrIChoYW5kbGUpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kbGVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB9XG4gICAgfTsgICAgXG59IiwiaW1wb3J0IHsgV2ViU29ja2V0SU8gfSBmcm9tIFwiLi93c2lvLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcbmltcG9ydCB7IERhdGFzZXQgfSBmcm9tIFwiLi9kYXRhc2V0LmpzXCI7XG5cbmNvbnN0IE1zZ1R5cGUgPSBPYmplY3QuZnJlZXplKHtcbiAgICBNRVNTQUdFIDogXCJNRVNTQUdFXCIsXG4gICAgUkVRVUVTVDogXCJSRVFVRVNUXCIsXG4gICAgUkVQTFk6IFwiUkVQTFlcIlxuIH0pO1xuIFxuY29uc3QgTXNnQ21kID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgR0VUIDogXCJHRVRcIixcbiAgICBQVVQ6IFwiUFVUXCIsXG4gICAgTk9USUZZOiBcIk5PVElGWVwiXG59KTtcblxuXG5leHBvcnQgY2xhc3MgU2hhcmVkU3RhdGVDbGllbnQgZXh0ZW5kcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3RvciAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKHVybCwgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gcmVxdWVzdHNcbiAgICAgICAgdGhpcy5fcmVxaWQgPSAwO1xuICAgICAgICB0aGlzLl9wZW5kaW5nID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgLy8gcGF0aCAtPiB7fSBcbiAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gZGF0YXNldHNcbiAgICAgICAgLy8gcGF0aCAtPiBkc1xuICAgICAgICB0aGlzLl9kc19tYXAgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMuX2RzX2hhbmRsZV9tYXAgPSBuZXcgTWFwKCk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBDT05ORUNUSU9OIFxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgICAgICAvLyByZWZyZXNoIGxvY2FsIHN1c2NyaXB0aW9uc1xuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuc2l6ZSA+IDApIHtcbiAgICAgICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnRoaXMuX3N1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29tbXVuaWNhdGlvbiBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBIQU5ETEVSU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBsZXQgbXNnID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuUkVQTFkpIHtcbiAgICAgICAgICAgIGxldCByZXFpZCA9IG1zZy50dW5uZWw7XG4gICAgICAgICAgICBpZiAodGhpcy5fcGVuZGluZy5oYXMocmVxaWQpKSB7XG4gICAgICAgICAgICAgICAgbGV0IHJlc29sdmVyID0gdGhpcy5fcGVuZGluZy5nZXQocmVxaWQpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3BlbmRpbmcuZGVsZXRlKHJlcWlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCB7b2ssIGRhdGF9ID0gbXNnO1xuICAgICAgICAgICAgICAgIHJlc29sdmVyKHtvaywgZGF0YX0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuTUVTU0FHRSkge1xuICAgICAgICAgICAgaWYgKG1zZy5jbWQgPT0gTXNnQ21kLk5PVElGWSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2hhbmRsZV9ub3RpZnkobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9oYW5kbGVfbm90aWZ5KG1zZykge1xuICAgICAgICAvLyB1cGRhdGUgZGF0YXNldCBzdGF0ZVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQobXNnW1wicGF0aFwiXSk7XG4gICAgICAgIGlmIChkcyAhPSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIGRzLl9zc2NsaWVudF91cGRhdGUobXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNFUlZFUiBSRVFVRVNUU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIF9yZXF1ZXN0KGNtZCwgcGF0aCwgYXJnKSB7XG4gICAgICAgIGNvbnN0IHJlcWlkID0gdGhpcy5fcmVxaWQrKztcbiAgICAgICAgY29uc3QgbXNnID0ge1xuICAgICAgICAgICAgdHlwZTogTXNnVHlwZS5SRVFVRVNULFxuICAgICAgICAgICAgY21kLCBcbiAgICAgICAgICAgIHBhdGgsIFxuICAgICAgICAgICAgYXJnLFxuICAgICAgICAgICAgdHVubmVsOiByZXFpZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlbmQoSlNPTi5zdHJpbmdpZnkobXNnKSk7XG4gICAgICAgIGxldCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgdGhpcy5fcGVuZGluZy5zZXQocmVxaWQsIHJlc29sdmVyKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgLy8gc3BlY2lhbCBoYW5kbGluZyBmb3IgcmVwbGllcyB0byBQVVQgL3N1YnNcbiAgICAgICAgICAgIGlmIChjbWQgPT0gTXNnQ21kLlBVVCAmJiBwYXRoID09IFwiL3N1YnNcIiAmJiBvaykge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzY3JpcHRpb24gc3RhdGVcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoZGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7b2ssIHBhdGgsIGRhdGF9O1xuICAgICAgICB9KTtcbiAgICB9XG5cbiAgICBfc3ViIChwYXRoKSB7XG4gICAgICAgIGlmICh0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgICAgIC8vIHNldCBuZXcgcGF0aFxuICAgICAgICAgICAgc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgcmV0dXJuIHRoaXMudXBkYXRlKFwiL3N1YnNcIiwge2luc2VydDppdGVtcywgcmVzZXQ6dHJ1ZX0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgLy8gdXBkYXRlIGxvY2FsIHN1YnMgLSBzdWJzY3JpYmUgb24gcmVjb25uZWN0XG4gICAgICAgICAgICB0aGlzLl9zdWJzX21hcC5zZXQocGF0aCwge30pO1xuICAgICAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSh7b2s6IHRydWUsIHBhdGgsIGRhdGE6dW5kZWZpbmVkfSlcbiAgICAgICAgfVxuXG4gICAgfVxuXG4gICAgX3Vuc3ViIChwYXRoKSB7XG4gICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgLy8gcmVtb3ZlIHBhdGhcbiAgICAgICAgc3Vic19tYXAuZGVsZXRlKHBhdGgpXG4gICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgIGNvbnN0IGl0ZW1zID0gWy4uLnN1YnNfbWFwLmVudHJpZXMoKV07XG4gICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIGdldChwYXRoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5HRVQsIHBhdGgpO1xuICAgIH1cbiAgICBcbiAgICB1cGRhdGUocGF0aCwgY2hhbmdlcykge1xuICAgICAgICByZXR1cm4gdGhpcy5fcmVxdWVzdChNc2dDbWQuUFVULCBwYXRoLCBjaGFuZ2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIGRhdGFzZXQgZm9yIHBhdGhcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlcyB0byBwYXRoIGlmIG5lZWRlZFxuICAgICAqIHJldHVybnMgaGFuZGxlIGFuZCBkYXRhc2V0XG4gICAgICogaGFuZGxlIHVzZWQgdG8gcmVsZWFzZSBkYXRhc2V0XG4gICAgICovXG5cbiAgICBhY3F1aXJlIChwYXRoKSB7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBkYXRhc2V0IGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9kc19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl9kc19tYXAuc2V0KHBhdGgsIG5ldyBEYXRhc2V0KHRoaXMsIHBhdGgpKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQocGF0aCk7XG4gICAgICAgIC8vIGNyZWF0ZSBoYW5kbGUgZm9yIHBhdGhcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge3BhdGh9O1xuICAgICAgICBpZiAoIXRoaXMuX2RzX2hhbmRsZV9tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl9kc19oYW5kbGVfbWFwLnNldChwYXRoLCBbXSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fZHNfaGFuZGxlX21hcC5nZXQocGF0aCkucHVzaChoYW5kbGUpO1xuICAgICAgICByZXR1cm4gW2hhbmRsZSwgZHNdO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIHJlbGVhc2UgZGF0YXNldCBieSBoYW5kbGVcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgdW5zdWJzY3JpYmUgaWYgYWxsIGhhbmRsZXMgaGF2ZSBiZWVuIHJlbGVhc2VkXG4gICAgICovXG5cbiAgICByZWxlYXNlIChoYW5kbGUpIHtcbiAgICAgICAgY29uc3QgcGF0aCA9IGhhbmRsZS5wYXRoO1xuICAgICAgICBjb25zdCBoYW5kbGVzID0gdGhpcy5fZHNfaGFuZGxlX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmIChoYW5kbGVzID09IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIC8vIHJlbW92ZSBoYW5kbGVcbiAgICAgICAgY29uc3QgaW5kZXggPSBoYW5kbGVzLmluZGV4T2YoaGFuZGxlKTtcbiAgICAgICAgaWYgKGluZGV4ID4gLTEpIHtcbiAgICAgICAgICAgIGhhbmRsZXMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgICAgICAvLyBjbGVhbiB1cCBpZiBsYXN0IGhhbmRsZSByZWxlYXNlZFxuICAgICAgICBpZiAoaGFuZGxlcy5sZW5ndGggPT0gMCkge1xuICAgICAgICAgICAgdGhpcy5fdW5zdWIocGF0aCk7XG4gICAgICAgICAgICAvLyBjbGVhci9kaXNhYmxlIGRhdGFzZXRcbiAgICAgICAgICAgIC8vIGNvbnN0IGRzID0gdGhpcy5fZHNfbWFwLmdldChwYXRoKTtcbiAgICAgICAgICAgIHRoaXMuX2RzX21hcC5kZWxldGUocGF0aCk7XG4gICAgICAgIH1cbiAgICB9XG59XG5cblxuIiwiLypcbiAgICBEYXRhc2V0IFZpZXdlclxuKi9cblxuZnVuY3Rpb24gaXRlbTJzdHJpbmcoaXRlbSkge1xuICAgIGNvbnN0IHtpZCwgaXR2LCBkYXRhfSA9IGl0ZW07XG4gICAgbGV0IGRhdGFfdHh0ID0gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgbGV0IGl0dl90eHQgPSAoaXR2ICE9IHVuZGVmaW5lZCkgPyBKU09OLnN0cmluZ2lmeShpdHYpIDogXCJcIjtcbiAgICBsZXQgaWRfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImlkXCI+JHtpZH08L3NwYW4+YDtcbiAgICBsZXQgaXR2X2h0bWwgPSBgPHNwYW4gY2xhc3M9XCJpdHZcIj4ke2l0dl90eHR9PC9zcGFuPmA7XG4gICAgbGV0IGRhdGFfaHRtbCA9IGA8c3BhbiBjbGFzcz1cImRhdGFcIj4ke2RhdGFfdHh0fTwvc3Bhbj5gO1xuICAgIHJldHVybiBgXG4gICAgICAgIDxkaXY+XG4gICAgICAgICAgICA8YnV0dG9uIGlkPVwiZGVsZXRlXCI+WDwvYnV0dG9uPlxuICAgICAgICAgICAgJHtpZF9odG1sfTogJHtpdHZfaHRtbH0gJHtkYXRhX2h0bWx9XG4gICAgICAgIDwvZGl2PmA7XG59XG5cblxuZXhwb3J0IGNsYXNzIERhdGFzZXRWaWV3ZXIge1xuXG4gICAgY29uc3RydWN0b3IoZGF0YXNldCwgZWxlbSwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl9kcyA9IGRhdGFzZXQ7XG4gICAgICAgIHRoaXMuX2VsZW0gPSBlbGVtO1xuICAgICAgICBjb25zdCBoYW5kbGUgPSB0aGlzLl9kcy5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7IFxuXG4gICAgICAgIC8vIG9wdGlvbnNcbiAgICAgICAgbGV0IGRlZmF1bHRzID0ge1xuICAgICAgICAgICAgZGVsZXRlOmZhbHNlLFxuICAgICAgICAgICAgdG9TdHJpbmc6aXRlbTJzdHJpbmdcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IHsuLi5kZWZhdWx0cywgLi4ub3B0aW9uc307XG5cbiAgICAgICAgLypcbiAgICAgICAgICAgIFN1cHBvcnQgZGVsZXRlXG4gICAgICAgICovXG4gICAgICAgIGlmICh0aGlzLl9vcHRpb25zLmRlbGV0ZSkge1xuICAgICAgICAgICAgLy8gbGlzdGVuIGZvciBjbGljayBldmVudHMgb24gcm9vdCBlbGVtZW50XG4gICAgICAgICAgICBlbGVtLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZSkgPT4ge1xuICAgICAgICAgICAgICAgIC8vIGNhdGNoIGNsaWNrIGV2ZW50IGZyb20gZGVsZXRlIGJ1dHRvblxuICAgICAgICAgICAgICAgIGNvbnN0IGRlbGV0ZUJ0biA9IGUudGFyZ2V0LmNsb3Nlc3QoXCIjZGVsZXRlXCIpO1xuICAgICAgICAgICAgICAgIGlmIChkZWxldGVCdG4pIHtcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgbGlzdEl0ZW0gPSBkZWxldGVCdG4uY2xvc2VzdChcIi5saXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIGlmIChsaXN0SXRlbSkge1xuICAgICAgICAgICAgICAgICAgICAgICAgdGhpcy5fZHMudXBkYXRlKHtyZW1vdmU6W2xpc3RJdGVtLmlkXX0pO1xuICAgICAgICAgICAgICAgICAgICAgICAgZS5zdG9wUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGNvbnN0IHt0b1N0cmluZ30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBmb3IgKGxldCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5uZXcpIHtcbiAgICAgICAgICAgICAgICAvLyBhZGRcbiAgICAgICAgICAgICAgICBsZXQgbm9kZSA9IHRoaXMuX2VsZW0ucXVlcnlTZWxlY3RvcihgIyR7ZGlmZi5pZH1gKTtcbiAgICAgICAgICAgICAgICBpZiAobm9kZSA9PSBudWxsKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiZGl2XCIpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLnNldEF0dHJpYnV0ZShcImlkXCIsIGRpZmYuaWQpO1xuICAgICAgICAgICAgICAgICAgICBub2RlLmNsYXNzTGlzdC5hZGQoXCJsaXN0LWl0ZW1cIik7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2VsZW0uYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIG5vZGUuaW5uZXJIVE1MID0gdG9TdHJpbmcoZGlmZi5uZXcpO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChkaWZmLm9sZCkge1xuICAgICAgICAgICAgICAgIC8vIHJlbW92ZVxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlKSB7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG59XG4iXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7SUFBQTtJQUNBO0lBQ0E7SUFDQTtJQUNBOztJQUVPLFNBQVMsaUJBQWlCLEdBQUc7SUFDcEMsSUFBSSxJQUFJLFFBQVE7SUFDaEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEtBQUs7SUFDbkQsUUFBUSxRQUFRLEdBQUcsT0FBTztJQUMxQixLQUFLLENBQUM7SUFDTixJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDO0lBQzlCOztJQ1ZBLE1BQU0sV0FBVyxHQUFHLENBQUM7O0lBRWQsTUFBTSxXQUFXLENBQUM7O0lBRXpCLElBQUksV0FBVyxDQUFDLEdBQUcsRUFBRSxPQUFPLENBQUMsRUFBRSxFQUFFO0lBQ2pDLFFBQVEsSUFBSSxDQUFDLElBQUksR0FBRyxHQUFHO0lBQ3ZCLFFBQVEsSUFBSSxDQUFDLEdBQUc7SUFDaEIsUUFBUSxJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUs7SUFDaEMsUUFBUSxJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUs7SUFDL0IsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLE9BQU87SUFDL0IsUUFBUSxJQUFJLENBQUMsUUFBUSxHQUFHLENBQUM7SUFDekIsUUFBUSxJQUFJLENBQUMsMEJBQTBCLEdBQUcsRUFBRTtJQUM1Qzs7SUFFQSxJQUFJLElBQUksVUFBVSxHQUFHLENBQUMsT0FBTyxJQUFJLENBQUMsV0FBVyxDQUFDO0lBQzlDLElBQUksSUFBSSxTQUFTLEdBQUcsQ0FBQyxPQUFPLElBQUksQ0FBQyxVQUFVLENBQUM7SUFDNUMsSUFBSSxJQUFJLEdBQUcsR0FBRyxDQUFDLE9BQU8sSUFBSSxDQUFDLElBQUksQ0FBQztJQUNoQyxJQUFJLElBQUksT0FBTyxHQUFHLENBQUMsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDOztJQUV4QyxJQUFJLE9BQU8sR0FBRzs7SUFFZCxRQUFRLElBQUksSUFBSSxDQUFDLFVBQVUsSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFO0lBQy9DLFlBQVksT0FBTyxDQUFDLEdBQUcsQ0FBQyx1Q0FBdUMsQ0FBQztJQUNoRSxZQUFZO0lBQ1o7SUFDQSxRQUFRLElBQUksSUFBSSxDQUFDLGNBQWMsRUFBRSxFQUFFO0lBQ25DLFlBQVksT0FBTyxDQUFDLEdBQUcsQ0FBQyxZQUFZLENBQUM7SUFDckMsWUFBWTtJQUNaOztJQUVBO0lBQ0EsUUFBUSxJQUFJLENBQUMsR0FBRyxHQUFHLElBQUksU0FBUyxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUM7SUFDM0MsUUFBUSxJQUFJLENBQUMsV0FBVyxHQUFHLElBQUk7SUFDL0IsUUFBUSxJQUFJLENBQUMsR0FBRyxDQUFDLE1BQU0sR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxDQUFDLENBQUM7SUFDL0MsUUFBUSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsR0FBRyxDQUFDLElBQUksSUFBSSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUMsSUFBSSxDQUFDO0lBQ3pELFFBQVEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQyxDQUFDO0lBQ2pELFFBQVEsSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEdBQUcsQ0FBQyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDO0lBQ2hELFFBQVEsSUFBSSxDQUFDLGFBQWEsRUFBRTtJQUM1Qjs7SUFFQSxJQUFJLFFBQVEsQ0FBQyxLQUFLLEVBQUU7SUFDcEIsUUFBUSxJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUs7SUFDaEMsUUFBUSxJQUFJLENBQUMsVUFBVSxHQUFHLElBQUk7SUFDOUI7SUFDQSxRQUFRLEtBQUssTUFBTSxRQUFRLElBQUksSUFBSSxDQUFDLDBCQUEwQixFQUFFO0lBQ2hFLFlBQVksUUFBUSxFQUFFO0lBQ3RCO0lBQ0EsUUFBUSxJQUFJLENBQUMsMEJBQTBCLEdBQUcsRUFBRTtJQUM1QztJQUNBLFFBQVEsSUFBSSxDQUFDLFFBQVEsR0FBRyxDQUFDO0lBQ3pCLFFBQVEsSUFBSSxDQUFDLFVBQVUsRUFBRTtJQUN6Qjs7SUFFQSxJQUFJLFNBQVMsQ0FBQyxLQUFLLEVBQUU7SUFDckIsUUFBUSxJQUFJLENBQUMsV0FBVyxHQUFHLEtBQUs7SUFDaEMsUUFBUSxJQUFJLENBQUMsVUFBVSxHQUFHLEtBQUs7SUFDL0IsUUFBUSxJQUFJLENBQUMsYUFBYSxDQUFDLEtBQUssQ0FBQztJQUNqQyxRQUFRLElBQUksQ0FBQyxRQUFRLElBQUksQ0FBQztJQUMxQixRQUFRLElBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxFQUFFLEVBQUU7SUFDcEMsWUFBWSxVQUFVLENBQUMsTUFBTTtJQUM3QixnQkFBZ0IsSUFBSSxDQUFDLE9BQU8sRUFBRTtJQUM5QixhQUFhLEVBQUUsSUFBSSxHQUFHLElBQUksQ0FBQyxRQUFRLENBQUM7SUFDcEMsU0FDQTs7SUFFQSxJQUFJLGNBQWMsR0FBRztJQUNyQixRQUFRLE1BQU0sQ0FBQyxPQUFPLENBQUMsV0FBVyxDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVE7SUFDbkQsUUFBUSxJQUFJLElBQUksQ0FBQyxRQUFRLElBQUksT0FBTyxFQUFFO0lBQ3RDLFlBQVksT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLGlDQUFpQyxFQUFFLE9BQU8sQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUN2RSxZQUFZLElBQUksQ0FBQyxXQUFXLEdBQUcsS0FBSztJQUNwQyxZQUFZLElBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSTtJQUNsQyxZQUFZLElBQUksQ0FBQyxHQUFHLENBQUMsTUFBTSxHQUFHLFNBQVM7SUFDdkMsWUFBWSxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsR0FBRyxTQUFTO0lBQzFDLFlBQVksSUFBSSxDQUFDLEdBQUcsQ0FBQyxPQUFPLEdBQUcsU0FBUztJQUN4QyxZQUFZLElBQUksQ0FBQyxHQUFHLENBQUMsT0FBTyxHQUFHLFNBQVM7SUFDeEMsWUFBWSxJQUFJLENBQUMsR0FBRyxHQUFHLFNBQVM7SUFDaEMsWUFBWSxPQUFPLElBQUk7SUFDdkI7SUFDQSxRQUFRLE9BQU8sS0FBSztJQUNwQjs7SUFFQSxJQUFJLGFBQWEsR0FBRztJQUNwQixRQUFRLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVE7SUFDM0MsUUFBUSxJQUFJLEtBQUssRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztJQUMxRDtJQUNBLElBQUksVUFBVSxHQUFHO0lBQ2pCLFFBQVEsT0FBTyxDQUFDLEdBQUcsQ0FBQyxDQUFDLFNBQVMsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUMzQztJQUNBLElBQUksUUFBUSxDQUFDLEtBQUssRUFBRTtJQUNwQixRQUFRLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVE7SUFDM0MsUUFBUSxJQUFJLEtBQUssRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxPQUFPLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ25EO0lBQ0EsSUFBSSxhQUFhLENBQUMsS0FBSyxFQUFFO0lBQ3pCLFFBQVEsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLFdBQVcsRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQztJQUMvQztJQUNBLElBQUksVUFBVSxDQUFDLElBQUksRUFBRTtJQUNyQixRQUFRLE1BQU0sQ0FBQyxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsSUFBSSxDQUFDLFFBQVE7SUFDM0MsUUFBUSxJQUFJLEtBQUssRUFBRSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ3BEOztJQUVBLElBQUksSUFBSSxDQUFDLElBQUksRUFBRTtJQUNmLFFBQVEsSUFBSSxJQUFJLENBQUMsVUFBVSxFQUFFO0lBQzdCLFlBQVksSUFBSTtJQUNoQixnQkFBZ0IsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ25DLGFBQWEsQ0FBQyxPQUFPLEtBQUssRUFBRTtJQUM1QixnQkFBZ0IsT0FBTyxDQUFDLEtBQUssQ0FBQyxDQUFDLFdBQVcsRUFBRSxLQUFLLENBQUMsQ0FBQyxDQUFDO0lBQ3BEO0lBQ0EsU0FBUyxNQUFNO0lBQ2YsWUFBWSxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMseUJBQXlCLENBQUM7SUFDbkQ7SUFDQTs7SUFFQSxJQUFJLGdCQUFnQixHQUFHO0lBQ3ZCLFFBQVEsTUFBTSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsR0FBRyxpQkFBaUIsRUFBRTtJQUN2RCxRQUFRLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtJQUM1QixZQUFZLFFBQVEsRUFBRTtJQUN0QixTQUFTLE1BQU07SUFDZixZQUFZLElBQUksQ0FBQywwQkFBMEIsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO0lBQzFEO0lBQ0EsUUFBUSxPQUFPLE9BQU87SUFDdEI7SUFDQTs7SUN6SE8sTUFBTSxPQUFPLENBQUM7O0lBRXJCLElBQUksV0FBVyxDQUFDLFFBQVEsRUFBRSxJQUFJLEVBQUU7SUFDaEM7SUFDQSxRQUFRLElBQUksQ0FBQyxTQUFTLEdBQUcsUUFBUTtJQUNqQyxRQUFRLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSTtJQUN6QjtJQUNBLFFBQVEsSUFBSSxDQUFDLFNBQVMsR0FBRyxFQUFFO0lBQzNCO0lBQ0EsUUFBUSxJQUFJLENBQUMsSUFBSSxHQUFHLElBQUksR0FBRyxFQUFFO0lBQzdCOztJQUVBO0lBQ0E7SUFDQTs7SUFFQTtJQUNBO0lBQ0E7SUFDQSxJQUFJLGdCQUFnQixDQUFDLENBQUMsT0FBTyxDQUFDLEVBQUUsRUFBRTs7SUFFbEMsUUFBUSxNQUFNLENBQUMsTUFBTSxFQUFFLE1BQU0sRUFBRSxLQUFLLENBQUMsS0FBSyxDQUFDLEdBQUcsT0FBTztJQUNyRCxRQUFRLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxFQUFFOztJQUVsQztJQUNBLFFBQVEsSUFBSSxLQUFLLEVBQUU7SUFDbkIsWUFBWSxLQUFLLE1BQU0sSUFBSSxJQUFJLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLEVBQUU7SUFDbkQsZ0JBQWdCLFFBQVEsQ0FBQyxHQUFHO0lBQzVCLG9CQUFvQixJQUFJLENBQUMsRUFBRTtJQUMzQixvQkFBb0IsQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxHQUFHLENBQUMsU0FBUyxFQUFFLEdBQUcsQ0FBQyxJQUFJO0lBQ3pELGlCQUFpQjtJQUNqQjtJQUNBLFlBQVksSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLEdBQUcsRUFBRTtJQUNqQyxTQUFTLE1BQU07SUFDZixZQUFZLEtBQUssTUFBTSxHQUFHLElBQUksTUFBTSxFQUFFO0lBQ3RDLGdCQUFnQixNQUFNLEdBQUcsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLENBQUM7SUFDOUMsZ0JBQWdCLElBQUksR0FBRyxJQUFJLFNBQVMsRUFBRTtJQUN0QyxvQkFBb0IsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsR0FBRyxDQUFDO0lBQ3pDLG9CQUFvQixRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLFNBQVMsRUFBRSxHQUFHLENBQUMsQ0FBQztJQUNuRTtJQUNBO0lBQ0E7O0lBRUE7SUFDQSxRQUFRLEtBQUssTUFBTSxJQUFJLElBQUksTUFBTSxFQUFFO0lBQ25DLFlBQVksTUFBTSxHQUFHLEdBQUcsSUFBSSxDQUFDLEVBQUU7SUFDL0I7SUFDQSxZQUFZLE1BQU0sSUFBSSxHQUFHLFFBQVEsQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO0lBQzFDLFlBQVksTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLElBQUksU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO0lBQzNFO0lBQ0EsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDO0lBQ3BDO0lBQ0EsWUFBWSxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN0RDtJQUNBLFFBQVEsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsR0FBRyxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUN0RDs7SUFFQSxJQUFJLGlCQUFpQixDQUFDLENBQUMsSUFBSSxFQUFFO0lBQzdCLFFBQVEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsU0FBUyxNQUFNLEVBQUU7SUFDaEQsWUFBWSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztJQUNoQyxTQUFTLENBQUM7SUFDVixLQUFLOztJQUVMO0lBQ0E7SUFDQTs7SUFFQTtJQUNBO0lBQ0E7SUFDQSxJQUFJLFNBQVMsR0FBRztJQUNoQixRQUFRLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7SUFDdEMsS0FBSztJQUNMLElBQUksSUFBSSxJQUFJLEdBQUcsQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ3RDLElBQUksUUFBUSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM1QyxJQUFJLFFBQVEsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQzs7SUFFMUM7SUFDQTtJQUNBO0lBQ0EsSUFBSSxNQUFNLENBQUMsQ0FBQyxPQUFPLENBQUMsRUFBRSxFQUFFO0lBQ3hCLFFBQVEsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxFQUFFLE9BQU8sQ0FBQztJQUN6RDs7SUFFQTtJQUNBO0lBQ0E7SUFDQSxJQUFJLFlBQVksQ0FBQyxDQUFDLE9BQU8sRUFBRTtJQUMzQixRQUFRLE1BQU0sTUFBTSxHQUFHLENBQUMsT0FBTyxDQUFDO0lBQ2hDLFFBQVEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDO0lBQ25DLFFBQVEsT0FBTyxNQUFNO0lBQ3JCLEtBQUs7SUFDTCxJQUFJLGVBQWUsQ0FBQyxDQUFDLE1BQU0sRUFBRTtJQUM3QixRQUFRLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQztJQUNwRCxRQUFRLElBQUksS0FBSyxHQUFHLEVBQUUsRUFBRTtJQUN4QixZQUFZLElBQUksQ0FBQyxTQUFTLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRSxDQUFDLENBQUM7SUFDM0M7SUFDQSxLQUFLO0lBQ0w7O0lDaEdBLE1BQU0sT0FBTyxHQUFHLE1BQU0sQ0FBQyxNQUFNLENBQUM7SUFDOUIsSUFBSSxPQUFPLEdBQUcsU0FBUztJQUN2QixJQUFJLE9BQU8sRUFBRSxTQUFTO0lBQ3RCLElBQUksS0FBSyxFQUFFO0lBQ1gsRUFBRSxDQUFDO0lBQ0g7SUFDQSxNQUFNLE1BQU0sR0FBRyxNQUFNLENBQUMsTUFBTSxDQUFDO0lBQzdCLElBQUksR0FBRyxHQUFHLEtBQUs7SUFDZixJQUFJLEdBQUcsRUFBRSxLQUFLO0lBQ2QsSUFBSSxNQUFNLEVBQUU7SUFDWixDQUFDLENBQUM7OztJQUdLLE1BQU0saUJBQWlCLFNBQVMsV0FBVyxDQUFDOztJQUVuRCxJQUFJLFdBQVcsQ0FBQyxDQUFDLEdBQUcsRUFBRSxPQUFPLEVBQUU7SUFDL0IsUUFBUSxLQUFLLENBQUMsR0FBRyxFQUFFLE9BQU8sQ0FBQzs7SUFFM0I7SUFDQSxRQUFRLElBQUksQ0FBQyxNQUFNLEdBQUcsQ0FBQztJQUN2QixRQUFRLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxHQUFHLEVBQUU7O0lBRWpDO0lBQ0E7SUFDQSxRQUFRLElBQUksQ0FBQyxTQUFTLEdBQUcsSUFBSSxHQUFHLEVBQUU7O0lBRWxDO0lBQ0E7SUFDQSxRQUFRLElBQUksQ0FBQyxPQUFPLEdBQUcsSUFBSSxHQUFHLEVBQUU7SUFDaEMsUUFBUSxJQUFJLENBQUMsY0FBYyxHQUFHLElBQUksR0FBRyxFQUFFO0lBQ3ZDOztJQUVBO0lBQ0E7SUFDQTs7SUFFQSxJQUFJLFVBQVUsR0FBRztJQUNqQixRQUFRLE9BQU8sQ0FBQyxHQUFHLENBQUMsQ0FBQyxTQUFTLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDM0M7SUFDQSxRQUFRLElBQUksSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxFQUFFO0lBQ3JDLFlBQVksTUFBTSxLQUFLLEdBQUcsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsT0FBTyxFQUFFLENBQUM7SUFDdkQsWUFBWSxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQzVEO0lBQ0E7SUFDQSxJQUFJLGFBQWEsR0FBRztJQUNwQixRQUFRLE9BQU8sQ0FBQyxLQUFLLENBQUMsQ0FBQyxXQUFXLEVBQUUsSUFBSSxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUM7SUFDL0M7SUFDQSxJQUFJLFFBQVEsQ0FBQyxLQUFLLEVBQUU7SUFDcEIsUUFBUSxNQUFNLENBQUMsS0FBSyxDQUFDLEtBQUssQ0FBQyxHQUFHLElBQUksQ0FBQyxRQUFRO0lBQzNDLFFBQVEsSUFBSSxLQUFLLEVBQUUsQ0FBQyxPQUFPLENBQUMsR0FBRyxDQUFDLENBQUMscUJBQXFCLEVBQUUsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2pFOztJQUVBO0lBQ0E7SUFDQTs7SUFFQSxJQUFJLFVBQVUsQ0FBQyxJQUFJLEVBQUU7SUFDckIsUUFBUSxJQUFJLEdBQUcsR0FBRyxJQUFJLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQztJQUNsQyxRQUFRLElBQUksR0FBRyxDQUFDLElBQUksSUFBSSxPQUFPLENBQUMsS0FBSyxFQUFFO0lBQ3ZDLFlBQVksSUFBSSxLQUFLLEdBQUcsR0FBRyxDQUFDLE1BQU07SUFDbEMsWUFBWSxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxFQUFFO0lBQzFDLGdCQUFnQixJQUFJLFFBQVEsR0FBRyxJQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxLQUFLLENBQUM7SUFDdkQsZ0JBQWdCLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEtBQUssQ0FBQztJQUMzQyxnQkFBZ0IsTUFBTSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsR0FBRyxHQUFHO0lBQ3RDLGdCQUFnQixRQUFRLENBQUMsQ0FBQyxFQUFFLEVBQUUsSUFBSSxDQUFDLENBQUM7SUFDcEM7SUFDQSxTQUFTLE1BQU0sSUFBSSxHQUFHLENBQUMsSUFBSSxJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUU7SUFDaEQsWUFBWSxJQUFJLEdBQUcsQ0FBQyxHQUFHLElBQUksTUFBTSxDQUFDLE1BQU0sRUFBRTtJQUMxQyxnQkFBZ0IsSUFBSSxDQUFDLGNBQWMsQ0FBQyxHQUFHLENBQUM7SUFDeEM7SUFDQTtJQUNBOztJQUVBLElBQUksY0FBYyxDQUFDLEdBQUcsRUFBRTtJQUN4QjtJQUNBLFFBQVEsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBQyxDQUFDO0lBQ2hELFFBQVEsSUFBSSxFQUFFLElBQUksU0FBUyxFQUFFO0lBQzdCLFlBQVksRUFBRSxDQUFDLGdCQUFnQixDQUFDLEdBQUcsQ0FBQyxNQUFNLENBQUMsQ0FBQztJQUM1QztJQUNBOztJQUVBO0lBQ0E7SUFDQTs7SUFFQSxJQUFJLFFBQVEsQ0FBQyxHQUFHLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRTtJQUM3QixRQUFRLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUU7SUFDbkMsUUFBUSxNQUFNLEdBQUcsR0FBRztJQUNwQixZQUFZLElBQUksRUFBRSxPQUFPLENBQUMsT0FBTztJQUNqQyxZQUFZLEdBQUc7SUFDZixZQUFZLElBQUk7SUFDaEIsWUFBWSxHQUFHO0lBQ2YsWUFBWSxNQUFNLEVBQUU7SUFDcEIsU0FBUztJQUNULFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFDO0lBQ3RDLFFBQVEsSUFBSSxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUMsR0FBRyxpQkFBaUIsRUFBRTtJQUNyRCxRQUFRLElBQUksQ0FBQyxRQUFRLENBQUMsR0FBRyxDQUFDLEtBQUssRUFBRSxRQUFRLENBQUM7SUFDMUMsUUFBUSxPQUFPLE9BQU8sQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUMsS0FBSztJQUM1QztJQUNBLFlBQVksSUFBSSxHQUFHLElBQUksTUFBTSxDQUFDLEdBQUcsSUFBSSxJQUFJLElBQUksT0FBTyxJQUFJLEVBQUUsRUFBRTtJQUM1RDtJQUNBLGdCQUFnQixJQUFJLENBQUMsU0FBUyxHQUFHLElBQUksR0FBRyxDQUFDLElBQUk7SUFDN0M7SUFDQSxZQUFZLE9BQU8sQ0FBQyxFQUFFLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQztJQUNuQyxTQUFTLENBQUM7SUFDVjs7SUFFQSxJQUFJLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRTtJQUNoQixRQUFRLElBQUksSUFBSSxDQUFDLFNBQVMsRUFBRTtJQUM1QjtJQUNBLFlBQVksTUFBTSxRQUFRLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUN6RDtJQUNBLFlBQVksUUFBUSxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDO0lBQ2xDO0lBQ0EsWUFBWSxNQUFNLEtBQUssR0FBRyxDQUFDLEdBQUcsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUN2RCxZQUFZLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUNuRSxTQUFTLE1BQU07SUFDZjtJQUNBLFlBQVksSUFBSSxDQUFDLFNBQVMsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQztJQUN4QyxZQUFZLE9BQU8sT0FBTyxDQUFDLE9BQU8sQ0FBQyxDQUFDLEVBQUUsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxTQUFTLENBQUM7SUFDbkU7O0lBRUE7O0lBRUEsSUFBSSxNQUFNLENBQUMsQ0FBQyxJQUFJLEVBQUU7SUFDbEI7SUFDQSxRQUFRLE1BQU0sUUFBUSxHQUFHLElBQUksR0FBRyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7SUFDckQ7SUFDQSxRQUFRLFFBQVEsQ0FBQyxNQUFNLENBQUMsSUFBSTtJQUM1QjtJQUNBLFFBQVEsTUFBTSxLQUFLLEdBQUcsQ0FBQyxHQUFHLFFBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztJQUM3QyxRQUFRLE9BQU8sSUFBSSxDQUFDLE1BQU0sQ0FBQyxPQUFPLEVBQUUsQ0FBQyxNQUFNLENBQUMsS0FBSyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvRDs7SUFFQTtJQUNBO0lBQ0E7O0lBRUEsSUFBSSxHQUFHLENBQUMsSUFBSSxFQUFFO0lBQ2QsUUFBUSxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUM7SUFDOUM7SUFDQTtJQUNBLElBQUksTUFBTSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7SUFDMUIsUUFBUSxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDO0lBQ3ZEOztJQUVBO0lBQ0E7SUFDQTtJQUNBO0lBQ0E7SUFDQTs7SUFFQSxJQUFJLE9BQU8sQ0FBQyxDQUFDLElBQUksRUFBRTtJQUNuQjtJQUNBLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFO0lBQ3ZDO0lBQ0EsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztJQUMzQjtJQUNBO0lBQ0EsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7SUFDckMsWUFBWSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVBQUUsSUFBSSxPQUFPLENBQUMsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO0lBQzNEO0lBQ0EsUUFBUSxNQUFNLEVBQUUs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
