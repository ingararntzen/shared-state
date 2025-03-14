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

    class Dataset {

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
         * Dataset released by ss client
         */

        _ssclient_terminate() {
            this._terminated = true;
            // empty dataset?
            // disconnect from observers
            this._handlers = [];
        }


        /**
         * server update dataset 
         */
        _ssclient_update (changes={}) {

            if (this._terminated) {
                throw new Error("dataset already terminated")
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
            if (this._terminated) {
                throw new Error("dataset already terminated")
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
     * Wrapper to expose a single id (item) from an dataset as a standalone variable
     * 
     * - if there is no item with id in dataset - the variable will be undefined
     *   or have a default value
     * - otherwise, the item will be the value of the variable
     * 
     *  Variable implements the same interface as a dataset
     *  
     *  Default value is given in options {value:}
     */

    class Variable {

        constructor(ds, id, options={}) {
            this._terminiated = false;
            this._ds = ds;
            this._id = id;
            this._options = options;
            // callback
            this._handlers = [];
            this._handle = this._ds.add_callback(this._onchange.bind(this));
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
        
        set value (value) {
            if (this._terminated) {
                throw new Error("varible terminated")
            }
            const items = [{id:this._id, data:value}];
            return this._ds.update({insert:items, reset:false});
        }

        get value() {
            if (this._ds.has_item(this._id)) {
                return this._ds.get_item(this._id).data;
            } else {
                return this._options.value;
            }
        }
        
        ss_client_terminate() {
            this._terminated = true;
            this._ds.remove_callback(this._handle);
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

            // datasets {path -> ds}
            this._ds_map = new Map();

            // variables {[path, id] -> variable}
            this._var_map = new Map();
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

        // get request for items by path
        get(path) {
            return this._request(MsgCmd.GET, path);
        }
        
        // update request for path
        update(path, changes) {
            return this._request(MsgCmd.PUT, path, changes);
        }

        /**
         * acquire dataset for path
         * - automatically subscribes to path if needed
         */

        acquire_dataset (path, options) {
            // subscribe if subscription does not exists
            if (!this._subs_map.has(path)) {
                // subscribe to path
                this._sub(path);
            }
            // create dataset if not exists
            if (!this._ds_map.has(path)) {
                this._ds_map.set(path, new Dataset(this, path, options));
            }
            return this._ds_map.get(path);
        }

        /**
         * acquire variable for (path, id)
         * - automatically acquire dataset
         */


        acquire_variable (path, name, options) {
            const ds = this.acquire_dataset(path);
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
         * release path, including datasets and variables
         */

        release(path) {
            // unsubscribe
            if (this._subs_map.has(path)) {
                this._unsub(path);
            }
            // terminate dataset and variables
            const ds = this._ds_map.get(path);
            ds._ssclient_terminate();
            const var_map = this._var_map.get(path);
            for (const v of var_map.values()) {
                v._ssclient_terminate();
            }
            this._ds_map.delete(path);
            this._var_map.delete(path);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2hhcmVkc3RhdGUuaWlmZS5qcyIsInNvdXJjZXMiOlsiLi4vLi4vc3JjL2NsaWVudC91dGlsLmpzIiwiLi4vLi4vc3JjL2NsaWVudC93c2lvLmpzIiwiLi4vLi4vc3JjL2NsaWVudC9kYXRhc2V0LmpzIiwiLi4vLi4vc3JjL2NsaWVudC92YXJpYWJsZS5qcyIsIi4uLy4uL3NyYy9jbGllbnQvc3NfY2xpZW50LmpzIiwiLi4vLi4vc3JjL2NsaWVudC92aWV3ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAgICBDcmVhdGUgYSBwcm9taXNlIHdoaWNoIGNhbiBiZSByZXNvbHZlZFxuICAgIHByb2dyYW1tYXRpY2FsbHkgYnkgZXh0ZXJuYWwgY29kZS5cbiAgICBSZXR1cm4gYSBwcm9taXNlIGFuZCBhIHJlc29sdmUgZnVuY3Rpb25cbiovXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZhYmxlUHJvbWlzZSgpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHJlc29sdmVyID0gcmVzb2x2ZTtcbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXRQcm9taXNlIChtcykge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgbGV0IHRpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgfSwgbXMpO1xuICAgICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgICAgIGlmICh0aWQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59XG5cblxuZXhwb3J0IGZ1bmN0aW9uIHJhbmRvbV9zdHJpbmcobGVuZ3RoKSB7XG4gICAgdmFyIHRleHQgPSBcIlwiO1xuICAgIHZhciBwb3NzaWJsZSA9IFwiQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5elwiO1xuICAgIGZvcih2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgICAgICB0ZXh0ICs9IHBvc3NpYmxlLmNoYXJBdChNYXRoLmZsb29yKE1hdGgucmFuZG9tKCkgKiBwb3NzaWJsZS5sZW5ndGgpKTtcbiAgICB9XG4gICAgcmV0dXJuIHRleHQ7XG59IiwiaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmNvbnN0IE1BWF9SRVRSSUVTID0gNDtcblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl91cmwgPSB1cmw7XG4gICAgICAgIHRoaXMuX3dzO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBnZXQgY29ubmVjdGluZygpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGluZzt9XG4gICAgZ2V0IGNvbm5lY3RlZCgpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGVkO31cbiAgICBnZXQgdXJsKCkge3JldHVybiB0aGlzLl91cmw7fVxuICAgIGdldCBvcHRpb25zKCkge3JldHVybiB0aGlzLl9vcHRpb25zO31cblxuICAgIGNvbm5lY3QoKSB7XG5cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGluZyB8fCB0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDb25uZWN0IHdoaWxlIGNvbm5lY3Rpbmcgb3IgY29ubmVjdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiVGVybWluYXRlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbm5lY3RpbmdcbiAgICAgICAgdGhpcy5fd3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuX3VybCk7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSBlID0+IHRoaXMuX29uX29wZW4oZSk7XG4gICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IGUgPT4gdGhpcy5vbl9tZXNzYWdlKGUuZGF0YSk7XG4gICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSBlID0+IHRoaXMuX29uX2Nsb3NlKGUpO1xuICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gZSA9PiB0aGlzLm9uX2Vycm9yKGUpO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3RpbmcoKTtcbiAgICB9XG5cbiAgICBfb25fb3BlbihldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgIC8vIHJlbGVhc2UgY29ubmVjdCBwcm9taXNlc1xuICAgICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgICAgICAvLyByZXNldCByZXRyaWVzIG9uIHN1Y2Nlc3NmdWwgY29ubmVjdGlvblxuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgX29uX2Nsb3NlKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMub25fZGlzY29ubmVjdChldmVudCk7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgKz0gMTtcbiAgICAgICAgaWYgKCF0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29ubmVjdCgpO1xuICAgICAgICAgICAgfSwgMTAwMCAqIHRoaXMuX3JldHJpZXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIF9pc190ZXJtaW5hdGVkKCkge1xuICAgICAgICBjb25zdCB7cmV0cmllcz1NQVhfUkVUUklFU30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAodGhpcy5fcmV0cmllcyA+PSByZXRyaWVzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVGVybWluYXRlZDogTWF4IHJldHJpZXMgcmVhY2hlZCAoJHtyZXRyaWVzfSlgKTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIG9uX2Nvbm5lY3RpbmcoKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29ubmVjdGluZyAke3RoaXMudXJsfWApO31cbiAgICB9XG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KGV2ZW50KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgUmVjZWl2ZTogJHtkYXRhfWApO31cbiAgICB9XG5cbiAgICBzZW5kKGRhdGEpIHtcbiAgICAgICAgaWYgKHRoaXMuX2Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLl93cy5zZW5kKGRhdGEpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTZW5kIGZhaWw6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VuZCBkcm9wIDogbm90IGNvbm5lY3RlZGApXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25uZWN0ZWRQcm9taXNlKCkge1xuICAgICAgICBjb25zdCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycy5wdXNoKHJlc29sdmVyKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgcmFuZG9tX3N0cmluZyB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuZXhwb3J0IGNsYXNzIERhdGFzZXQge1xuXG4gICAgY29uc3RydWN0b3Ioc3NjbGllbnQsIHBhdGgsIG9wdGlvbnM9e30pIHtcbiAgICAgICAgdGhpcy5fb3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmF0ZWQgPSBmYWxzZTtcbiAgICAgICAgLy8gc2hhcmVkc3RhdGUgY2xpZW50XG4gICAgICAgIHRoaXMuX3NzY2xpZW50ID0gc3NjbGllbnQ7XG4gICAgICAgIHRoaXMuX3BhdGggPSBwYXRoO1xuICAgICAgICAvLyBjYWxsYmFja3NcbiAgICAgICAgdGhpcy5faGFuZGxlcnMgPSBbXTtcbiAgICAgICAgLy8gaXRlbXNcbiAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgU0hBUkVEIFNUQVRFIENMSUVOVCBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuICAgIC8qKlxuICAgICAqIERhdGFzZXQgcmVsZWFzZWQgYnkgc3MgY2xpZW50XG4gICAgICovXG5cbiAgICBfc3NjbGllbnRfdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgLy8gZW1wdHkgZGF0YXNldD9cbiAgICAgICAgLy8gZGlzY29ubmVjdCBmcm9tIG9ic2VydmVyc1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgIH1cblxuXG4gICAgLyoqXG4gICAgICogc2VydmVyIHVwZGF0ZSBkYXRhc2V0IFxuICAgICAqL1xuICAgIF9zc2NsaWVudF91cGRhdGUgKGNoYW5nZXM9e30pIHtcblxuICAgICAgICBpZiAodGhpcy5fdGVybWluYXRlZCkge1xuICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFwiZGF0YXNldCBhbHJlYWR5IHRlcm1pbmF0ZWRcIilcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IHtyZW1vdmUsIGluc2VydCwgcmVzZXQ9ZmFsc2V9ID0gY2hhbmdlcztcbiAgICAgICAgY29uc3QgZGlmZl9tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gcmVtb3ZlIGl0ZW1zIC0gY3JlYXRlIGRpZmZcbiAgICAgICAgaWYgKHJlc2V0KSB7XG4gICAgICAgICAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgdGhpcy5fbWFwLnZhbHVlcygpKSB7XG4gICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KFxuICAgICAgICAgICAgICAgICAgICBpdGVtLmlkLCBcbiAgICAgICAgICAgICAgICAgICAge2lkOiBpdGVtLmlkLCBuZXc6dW5kZWZpbmVkLCBvbGQ6aXRlbX1cbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdGhpcy5fbWFwID0gbmV3IE1hcCgpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZm9yIChjb25zdCBfaWQgb2YgcmVtb3ZlKSB7XG4gICAgICAgICAgICAgICAgY29uc3Qgb2xkID0gdGhpcy5fbWFwLmdldChfaWQpO1xuICAgICAgICAgICAgICAgIGlmIChvbGQgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX21hcC5kZWxldGUoX2lkKTtcbiAgICAgICAgICAgICAgICAgICAgZGlmZl9tYXAuc2V0KF9pZCwge2lkOl9pZCwgbmV3OnVuZGVmaW5lZCwgb2xkfSk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gaW5zZXJ0IGl0ZW1zIC0gdXBkYXRlIGRpZmZcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIGluc2VydCkge1xuICAgICAgICAgICAgY29uc3QgX2lkID0gaXRlbS5pZDtcbiAgICAgICAgICAgIC8vIG9sZCBmcm9tIGRpZmZfbWFwIG9yIF9tYXBcbiAgICAgICAgICAgIGNvbnN0IGRpZmYgPSBkaWZmX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IG9sZCA9IChkaWZmICE9IHVuZGVmaW5lZCkgPyBkaWZmLm9sZCA6IHRoaXMuX21hcC5nZXQoX2lkKTtcbiAgICAgICAgICAgIC8vIHNldCBzdGF0ZVxuICAgICAgICAgICAgdGhpcy5fbWFwLnNldChfaWQsIGl0ZW0pO1xuICAgICAgICAgICAgLy8gdXBkYXRlIGRpZmYgbWFwXG4gICAgICAgICAgICBkaWZmX21hcC5zZXQoX2lkLCB7aWQ6X2lkLCBuZXc6aXRlbSwgb2xkfSk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fbm90aWZ5X2NhbGxiYWNrcyhbLi4uZGlmZl9tYXAudmFsdWVzKCldKTtcbiAgICB9XG5cbiAgICBfbm90aWZ5X2NhbGxiYWNrcyAoZUFyZykge1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5mb3JFYWNoKGZ1bmN0aW9uKGhhbmRsZSkge1xuICAgICAgICAgICAgaGFuZGxlLmhhbmRsZXIoZUFyZyk7XG4gICAgICAgIH0pO1xuICAgIH07XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIEFQUExJQ0FUSU9OIEFQSVxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICAvKipcbiAgICAgKiBhcHBsaWNhdGlvbiByZXF1ZXN0aW5nIGl0ZW1zXG4gICAgICovXG4gICAgZ2V0X2l0ZW1zKCkge1xuICAgICAgICByZXR1cm4gWy4uLnRoaXMuX21hcC52YWx1ZXMoKV07XG4gICAgfTtcbiAgICBnZXQgc2l6ZSgpIHtyZXR1cm4gdGhpcy5fbWFwLnNpemV9O1xuICAgIGdldF9pdGVtIChpZCkge3JldHVybiB0aGlzLl9tYXAuZ2V0KGlkKX0gXG4gICAgaGFzX2l0ZW0oaWQpIHtyZXR1cm4gdGhpcy5fbWFwLmhhcyhpZCl9XG5cbiAgICAvKipcbiAgICAgKiBhcHBsaWNhdGlvbiBkaXNwYXRjaGluZyB1cGRhdGUgdG8gc2VydmVyXG4gICAgICovXG4gICAgdXBkYXRlIChjaGFuZ2VzPXt9KSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJkYXRhc2V0IGFscmVhZHkgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIC8vIGVuc3VyZSB0aGF0IGluc2VydGVkIGl0ZW1zIGhhdmUgaWRzXG4gICAgICAgIGNvbnN0IHtpbnNlcnQ9W119ID0gY2hhbmdlcztcbiAgICAgICAgY2hhbmdlcy5pbnNlcnQgPSBpbnNlcnQubWFwKChpdGVtKSA9PiB7XG4gICAgICAgICAgICBpdGVtLmlkID0gaXRlbS5pZCB8fCByYW5kb21fc3RyaW5nKDEwKTtcbiAgICAgICAgICAgIHJldHVybiBpdGVtO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3NzY2xpZW50LnVwZGF0ZSh0aGlzLl9wYXRoLCBjaGFuZ2VzKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhcHBsaWNhdGlvbiByZWdpc3RlciBjYWxsYmFja1xuICAgICovXG4gICAgYWRkX2NhbGxiYWNrIChoYW5kbGVyKSB7XG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtoYW5kbGVyfTtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMucHVzaChoYW5kbGUpO1xuICAgICAgICByZXR1cm4gaGFuZGxlO1xuICAgIH07ICAgIFxuICAgIHJlbW92ZV9jYWxsYmFjayAoaGFuZGxlKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gdGhpcy5faGFuZGxlcnMuaW5kZXhPZihoYW5kbGUpO1xuICAgICAgICBpZiAoaW5kZXggPiAtMSkge1xuICAgICAgICAgICAgdGhpcy5faGFuZGxlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgfVxuICAgIH07ICAgIFxufSIsIlxuLyoqXG4gKiBWYXJpYWJsZVxuICogXG4gKiBXcmFwcGVyIHRvIGV4cG9zZSBhIHNpbmdsZSBpZCAoaXRlbSkgZnJvbSBhbiBkYXRhc2V0IGFzIGEgc3RhbmRhbG9uZSB2YXJpYWJsZVxuICogXG4gKiAtIGlmIHRoZXJlIGlzIG5vIGl0ZW0gd2l0aCBpZCBpbiBkYXRhc2V0IC0gdGhlIHZhcmlhYmxlIHdpbGwgYmUgdW5kZWZpbmVkXG4gKiAgIG9yIGhhdmUgYSBkZWZhdWx0IHZhbHVlXG4gKiAtIG90aGVyd2lzZSwgdGhlIGl0ZW0gd2lsbCBiZSB0aGUgdmFsdWUgb2YgdGhlIHZhcmlhYmxlXG4gKiBcbiAqICBWYXJpYWJsZSBpbXBsZW1lbnRzIHRoZSBzYW1lIGludGVyZmFjZSBhcyBhIGRhdGFzZXRcbiAqICBcbiAqICBEZWZhdWx0IHZhbHVlIGlzIGdpdmVuIGluIG9wdGlvbnMge3ZhbHVlOn1cbiAqL1xuXG5leHBvcnQgY2xhc3MgVmFyaWFibGUge1xuXG4gICAgY29uc3RydWN0b3IoZHMsIGlkLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX3Rlcm1pbmlhdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2RzID0gZHM7XG4gICAgICAgIHRoaXMuX2lkID0gaWQ7XG4gICAgICAgIHRoaXMuX29wdGlvbnMgPSBvcHRpb25zO1xuICAgICAgICAvLyBjYWxsYmFja1xuICAgICAgICB0aGlzLl9oYW5kbGVycyA9IFtdO1xuICAgICAgICB0aGlzLl9oYW5kbGUgPSB0aGlzLl9kcy5hZGRfY2FsbGJhY2sodGhpcy5fb25jaGFuZ2UuYmluZCh0aGlzKSk7XG4gICAgfVxuXG4gICAgX29uY2hhbmdlKGRpZmZzKSB7XG4gICAgICAgIGlmICh0aGlzLl90ZXJtaW5hdGVkKSB7XG4gICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXCJ2YXJpYWJsZSB0ZXJtaW5hdGVkXCIpXG4gICAgICAgIH1cbiAgICAgICAgZm9yIChjb25zdCBkaWZmIG9mIGRpZmZzKSB7XG4gICAgICAgICAgICBpZiAoZGlmZi5pZCA9PSB0aGlzLl9pZCkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2l0ZW0gPSBkaWZmLm5ldztcbiAgICAgICAgICAgICAgICB0aGlzLm5vdGlmeV9jYWxsYmFja3MoZGlmZik7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBhZGRfY2FsbGJhY2sgKGhhbmRsZXIpIHtcbiAgICAgICAgY29uc3QgaGFuZGxlID0ge2hhbmRsZXI6IGhhbmRsZXJ9O1xuICAgICAgICB0aGlzLl9oYW5kbGVycy5wdXNoKGhhbmRsZSk7XG4gICAgICAgIHJldHVybiBoYW5kbGU7XG4gICAgfTtcbiAgICBcbiAgICByZW1vdmVfY2FsbGJhY2sgKGhhbmRsZSkge1xuICAgICAgICBsZXQgaW5kZXggPSB0aGlzLl9oYW5kbGVycy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICB0aGlzLl9oYW5kZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICB9O1xuICAgIFxuICAgIG5vdGlmeV9jYWxsYmFja3MgKGVBcmcpIHtcbiAgICAgICAgdGhpcy5faGFuZGxlcnMuZm9yRWFjaChmdW5jdGlvbihoYW5kbGUpIHtcbiAgICAgICAgICAgIGhhbmRsZS5oYW5kbGVyKGVBcmcpO1xuICAgICAgICB9KTtcbiAgICB9O1xuICAgIFxuICAgIHNldCB2YWx1ZSAodmFsdWUpIHtcbiAgICAgICAgaWYgKHRoaXMuX3Rlcm1pbmF0ZWQpIHtcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcInZhcmlibGUgdGVybWluYXRlZFwiKVxuICAgICAgICB9XG4gICAgICAgIGNvbnN0IGl0ZW1zID0gW3tpZDp0aGlzLl9pZCwgZGF0YTp2YWx1ZX1dO1xuICAgICAgICByZXR1cm4gdGhpcy5fZHMudXBkYXRlKHtpbnNlcnQ6aXRlbXMsIHJlc2V0OmZhbHNlfSk7XG4gICAgfVxuXG4gICAgZ2V0IHZhbHVlKCkge1xuICAgICAgICBpZiAodGhpcy5fZHMuaGFzX2l0ZW0odGhpcy5faWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fZHMuZ2V0X2l0ZW0odGhpcy5faWQpLmRhdGE7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICByZXR1cm4gdGhpcy5fb3B0aW9ucy52YWx1ZTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBcbiAgICBzc19jbGllbnRfdGVybWluYXRlKCkge1xuICAgICAgICB0aGlzLl90ZXJtaW5hdGVkID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5fZHMucmVtb3ZlX2NhbGxiYWNrKHRoaXMuX2hhbmRsZSk7XG4gICAgfVxufSIsImltcG9ydCB7IFdlYlNvY2tldElPIH0gZnJvbSBcIi4vd3Npby5qc1wiO1xuaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5pbXBvcnQgeyBEYXRhc2V0IH0gZnJvbSBcIi4vZGF0YXNldC5qc1wiO1xuaW1wb3J0IHsgVmFyaWFibGUgfSBmcm9tIFwiLi92YXJpYWJsZS5qc1wiO1xuXG5jb25zdCBNc2dUeXBlID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgTUVTU0FHRSA6IFwiTUVTU0FHRVwiLFxuICAgIFJFUVVFU1Q6IFwiUkVRVUVTVFwiLFxuICAgIFJFUExZOiBcIlJFUExZXCJcbiB9KTtcbiBcbmNvbnN0IE1zZ0NtZCA9IE9iamVjdC5mcmVlemUoe1xuICAgIEdFVCA6IFwiR0VUXCIsXG4gICAgUFVUOiBcIlBVVFwiLFxuICAgIE5PVElGWTogXCJOT1RJRllcIlxufSk7XG5cblxuZXhwb3J0IGNsYXNzIFNoYXJlZFN0YXRlQ2xpZW50IGV4dGVuZHMgV2ViU29ja2V0SU8ge1xuXG4gICAgY29uc3RydWN0b3IgKHVybCwgb3B0aW9ucykge1xuICAgICAgICBzdXBlcih1cmwsIG9wdGlvbnMpO1xuXG4gICAgICAgIC8vIHJlcXVlc3RzXG4gICAgICAgIHRoaXMuX3JlcWlkID0gMDtcbiAgICAgICAgdGhpcy5fcGVuZGluZyA9IG5ldyBNYXAoKTtcblxuICAgICAgICAvLyBzdWJzY3JpcHRpb25zXG4gICAgICAgIC8vIHBhdGggLT4ge30gXG4gICAgICAgIHRoaXMuX3N1YnNfbWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIGRhdGFzZXRzIHtwYXRoIC0+IGRzfVxuICAgICAgICB0aGlzLl9kc19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gdmFyaWFibGVzIHtbcGF0aCwgaWRdIC0+IHZhcmlhYmxlfVxuICAgICAgICB0aGlzLl92YXJfbWFwID0gbmV3IE1hcCgpO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQ09OTkVDVElPTiBcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9jb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmxvZyhgQ29ubmVjdCAgJHt0aGlzLnVybH1gKTtcbiAgICAgICAgLy8gcmVmcmVzaCBsb2NhbCBzdXNjcmlwdGlvbnNcbiAgICAgICAgaWYgKHRoaXMuX3N1YnNfbWFwLnNpemUgPiAwKSB7XG4gICAgICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi50aGlzLl9zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICAgICAgdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgICAgIH1cbiAgICB9XG4gICAgb25fZGlzY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5lcnJvcihgRGlzY29ubmVjdCAke3RoaXMudXJsfWApO1xuICAgIH1cbiAgICBvbl9lcnJvcihlcnJvcikge1xuICAgICAgICBjb25zdCB7ZGVidWc9ZmFsc2V9ID0gdGhpcy5fb3B0aW9ucztcbiAgICAgICAgaWYgKGRlYnVnKSB7Y29uc29sZS5sb2coYENvbW11bmljYXRpb24gRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgSEFORExFUlNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBvbl9tZXNzYWdlKGRhdGEpIHtcbiAgICAgICAgbGV0IG1zZyA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICAgIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLlJFUExZKSB7XG4gICAgICAgICAgICBsZXQgcmVxaWQgPSBtc2cudHVubmVsO1xuICAgICAgICAgICAgaWYgKHRoaXMuX3BlbmRpbmcuaGFzKHJlcWlkKSkge1xuICAgICAgICAgICAgICAgIGxldCByZXNvbHZlciA9IHRoaXMuX3BlbmRpbmcuZ2V0KHJlcWlkKTtcbiAgICAgICAgICAgICAgICB0aGlzLl9wZW5kaW5nLmRlbGV0ZShyZXFpZCk7XG4gICAgICAgICAgICAgICAgY29uc3Qge29rLCBkYXRhfSA9IG1zZztcbiAgICAgICAgICAgICAgICByZXNvbHZlcih7b2ssIGRhdGF9KTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlIGlmIChtc2cudHlwZSA9PSBNc2dUeXBlLk1FU1NBR0UpIHtcbiAgICAgICAgICAgIGlmIChtc2cuY21kID09IE1zZ0NtZC5OT1RJRlkpIHtcbiAgICAgICAgICAgICAgICB0aGlzLl9oYW5kbGVfbm90aWZ5KG1zZyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX25vdGlmeShtc2cpIHtcbiAgICAgICAgLy8gdXBkYXRlIGRhdGFzZXQgc3RhdGVcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9kc19tYXAuZ2V0KG1zZ1tcInBhdGhcIl0pO1xuICAgICAgICBpZiAoZHMgIT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgICBkcy5fc3NjbGllbnRfdXBkYXRlKG1zZ1tcImRhdGFcIl0pO1xuICAgICAgICB9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBTRVJWRVIgUkVRVUVTVFNcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICBfcmVxdWVzdChjbWQsIHBhdGgsIGFyZykge1xuICAgICAgICBjb25zdCByZXFpZCA9IHRoaXMuX3JlcWlkKys7XG4gICAgICAgIGNvbnN0IG1zZyA9IHtcbiAgICAgICAgICAgIHR5cGU6IE1zZ1R5cGUuUkVRVUVTVCxcbiAgICAgICAgICAgIGNtZCwgXG4gICAgICAgICAgICBwYXRoLCBcbiAgICAgICAgICAgIGFyZyxcbiAgICAgICAgICAgIHR1bm5lbDogcmVxaWRcbiAgICAgICAgfTtcbiAgICAgICAgdGhpcy5zZW5kKEpTT04uc3RyaW5naWZ5KG1zZykpO1xuICAgICAgICBsZXQgW3Byb21pc2UsIHJlc29sdmVyXSA9IHJlc29sdmFibGVQcm9taXNlKCk7XG4gICAgICAgIHRoaXMuX3BlbmRpbmcuc2V0KHJlcWlkLCByZXNvbHZlcik7XG4gICAgICAgIHJldHVybiBwcm9taXNlLnRoZW4oKHtvaywgZGF0YX0pID0+IHtcbiAgICAgICAgICAgIC8vIHNwZWNpYWwgaGFuZGxpbmcgZm9yIHJlcGxpZXMgdG8gUFVUIC9zdWJzXG4gICAgICAgICAgICBpZiAoY21kID09IE1zZ0NtZC5QVVQgJiYgcGF0aCA9PSBcIi9zdWJzXCIgJiYgb2spIHtcbiAgICAgICAgICAgICAgICAvLyB1cGRhdGUgbG9jYWwgc3Vic2NyaXB0aW9uIHN0YXRlXG4gICAgICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKGRhdGEpXG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4ge29rLCBwYXRoLCBkYXRhfTtcbiAgICAgICAgfSk7XG4gICAgfVxuXG4gICAgX3N1YiAocGF0aCkge1xuICAgICAgICBpZiAodGhpcy5jb25uZWN0ZWQpIHtcbiAgICAgICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgICAgICAvLyBzZXQgbmV3IHBhdGhcbiAgICAgICAgICAgIHN1YnNfbWFwLnNldChwYXRoLCB7fSk7XG4gICAgICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICAgICAgY29uc3QgaXRlbXMgPSBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXTtcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnVwZGF0ZShcIi9zdWJzXCIsIHtpbnNlcnQ6aXRlbXMsIHJlc2V0OnRydWV9KTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzIC0gc3Vic2NyaWJlIG9uIHJlY29ubmVjdFxuICAgICAgICAgICAgdGhpcy5fc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgICAgIHJldHVybiBQcm9taXNlLnJlc29sdmUoe29rOiB0cnVlLCBwYXRoLCBkYXRhOnVuZGVmaW5lZH0pXG4gICAgICAgIH1cblxuICAgIH1cblxuICAgIF91bnN1YiAocGF0aCkge1xuICAgICAgICAvLyBjb3B5IGN1cnJlbnQgc3RhdGUgb2Ygc3Vic1xuICAgICAgICBjb25zdCBzdWJzX21hcCA9IG5ldyBNYXAoWy4uLnRoaXMuX3N1YnNfbWFwXSk7XG4gICAgICAgIC8vIHJlbW92ZSBwYXRoXG4gICAgICAgIHN1YnNfbWFwLmRlbGV0ZShwYXRoKVxuICAgICAgICAvLyByZXNldCBzdWJzIG9uIHNlcnZlclxuICAgICAgICBjb25zdCBpdGVtcyA9IFsuLi5zdWJzX21hcC5lbnRyaWVzKCldO1xuICAgICAgICByZXR1cm4gdGhpcy51cGRhdGUoXCIvc3Vic1wiLCB7aW5zZXJ0Oml0ZW1zLCByZXNldDp0cnVlfSk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBBUElcbiAgICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXG5cbiAgICAvLyBnZXQgcmVxdWVzdCBmb3IgaXRlbXMgYnkgcGF0aFxuICAgIGdldChwYXRoKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5HRVQsIHBhdGgpO1xuICAgIH1cbiAgICBcbiAgICAvLyB1cGRhdGUgcmVxdWVzdCBmb3IgcGF0aFxuICAgIHVwZGF0ZShwYXRoLCBjaGFuZ2VzKSB7XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5QVVQsIHBhdGgsIGNoYW5nZXMpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFjcXVpcmUgZGF0YXNldCBmb3IgcGF0aFxuICAgICAqIC0gYXV0b21hdGljYWxseSBzdWJzY3JpYmVzIHRvIHBhdGggaWYgbmVlZGVkXG4gICAgICovXG5cbiAgICBhY3F1aXJlX2RhdGFzZXQgKHBhdGgsIG9wdGlvbnMpIHtcbiAgICAgICAgLy8gc3Vic2NyaWJlIGlmIHN1YnNjcmlwdGlvbiBkb2VzIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9zdWJzX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIC8vIHN1YnNjcmliZSB0byBwYXRoXG4gICAgICAgICAgICB0aGlzLl9zdWIocGF0aCk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY3JlYXRlIGRhdGFzZXQgaWYgbm90IGV4aXN0c1xuICAgICAgICBpZiAoIXRoaXMuX2RzX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX2RzX21hcC5zZXQocGF0aCwgbmV3IERhdGFzZXQodGhpcywgcGF0aCwgb3B0aW9ucykpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0aGlzLl9kc19tYXAuZ2V0KHBhdGgpO1xuICAgIH1cblxuICAgIC8qKlxuICAgICAqIGFjcXVpcmUgdmFyaWFibGUgZm9yIChwYXRoLCBpZClcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgYWNxdWlyZSBkYXRhc2V0XG4gICAgICovXG5cblxuICAgIGFjcXVpcmVfdmFyaWFibGUgKHBhdGgsIG5hbWUsIG9wdGlvbnMpIHtcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLmFjcXVpcmVfZGF0YXNldChwYXRoKTtcbiAgICAgICAgLy8gY3JlYXRlIHZhcmlhYmxlIGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl92YXJfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fdmFyX21hcC5zZXQocGF0aCwgbmV3IE1hcCgpKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCB2YXJfbWFwID0gdGhpcy5fdmFyX21hcC5nZXQocGF0aCk7XG4gICAgICAgIGlmICghdmFyX21hcC5nZXQobmFtZSkpIHtcbiAgICAgICAgICAgIHZhcl9tYXAuc2V0KG5hbWUsIG5ldyBWYXJpYWJsZShkcywgbmFtZSwgb3B0aW9ucykpXG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHZhcl9tYXAuZ2V0KG5hbWUpXG4gICAgfVxuXG4gICAgLyoqXG4gICAgICogcmVsZWFzZSBwYXRoLCBpbmNsdWRpbmcgZGF0YXNldHMgYW5kIHZhcmlhYmxlc1xuICAgICAqL1xuXG4gICAgcmVsZWFzZShwYXRoKSB7XG4gICAgICAgIC8vIHVuc3Vic2NyaWJlXG4gICAgICAgIGlmICh0aGlzLl9zdWJzX21hcC5oYXMocGF0aCkpIHtcbiAgICAgICAgICAgIHRoaXMuX3Vuc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIHRlcm1pbmF0ZSBkYXRhc2V0IGFuZCB2YXJpYWJsZXNcbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9kc19tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBkcy5fc3NjbGllbnRfdGVybWluYXRlKCk7XG4gICAgICAgIGNvbnN0IHZhcl9tYXAgPSB0aGlzLl92YXJfbWFwLmdldChwYXRoKTtcbiAgICAgICAgZm9yIChjb25zdCB2IG9mIHZhcl9tYXAudmFsdWVzKCkpIHtcbiAgICAgICAgICAgIHYuX3NzY2xpZW50X3Rlcm1pbmF0ZSgpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2RzX21hcC5kZWxldGUocGF0aCk7XG4gICAgICAgIHRoaXMuX3Zhcl9tYXAuZGVsZXRlKHBhdGgpO1xuICAgIH1cbn1cblxuXG4iLCIvKlxuICAgIERhdGFzZXQgVmlld2VyXG4qL1xuXG5mdW5jdGlvbiBpdGVtMnN0cmluZyhpdGVtKSB7XG4gICAgY29uc3Qge2lkLCBpdHYsIGRhdGF9ID0gaXRlbTtcbiAgICBsZXQgZGF0YV90eHQgPSBKU09OLnN0cmluZ2lmeShkYXRhKTtcbiAgICBsZXQgaXR2X3R4dCA9IChpdHYgIT0gdW5kZWZpbmVkKSA/IEpTT04uc3RyaW5naWZ5KGl0dikgOiBcIlwiO1xuICAgIGxldCBpZF9odG1sID0gYDxzcGFuIGNsYXNzPVwiaWRcIj4ke2lkfTwvc3Bhbj5gO1xuICAgIGxldCBpdHZfaHRtbCA9IGA8c3BhbiBjbGFzcz1cIml0dlwiPiR7aXR2X3R4dH08L3NwYW4+YDtcbiAgICBsZXQgZGF0YV9odG1sID0gYDxzcGFuIGNsYXNzPVwiZGF0YVwiPiR7ZGF0YV90eHR9PC9zcGFuPmA7XG4gICAgcmV0dXJuIGBcbiAgICAgICAgPGRpdj5cbiAgICAgICAgICAgIDxidXR0b24gaWQ9XCJkZWxldGVcIj5YPC9idXR0b24+XG4gICAgICAgICAgICAke2lkX2h0bWx9OiAke2l0dl9odG1sfSAke2RhdGFfaHRtbH1cbiAgICAgICAgPC9kaXY+YDtcbn1cblxuXG5leHBvcnQgY2xhc3MgRGF0YXNldFZpZXdlciB7XG5cbiAgICBjb25zdHJ1Y3RvcihkYXRhc2V0LCBlbGVtLCBvcHRpb25zPXt9KSB7XG4gICAgICAgIHRoaXMuX2RzID0gZGF0YXNldDtcbiAgICAgICAgdGhpcy5fZWxlbSA9IGVsZW07XG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHRoaXMuX2RzLmFkZF9jYWxsYmFjayh0aGlzLl9vbmNoYW5nZS5iaW5kKHRoaXMpKTsgXG5cbiAgICAgICAgLy8gb3B0aW9uc1xuICAgICAgICBsZXQgZGVmYXVsdHMgPSB7XG4gICAgICAgICAgICBkZWxldGU6ZmFsc2UsXG4gICAgICAgICAgICB0b1N0cmluZzppdGVtMnN0cmluZ1xuICAgICAgICB9O1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gey4uLmRlZmF1bHRzLCAuLi5vcHRpb25zfTtcblxuICAgICAgICAvKlxuICAgICAgICAgICAgU3VwcG9ydCBkZWxldGVcbiAgICAgICAgKi9cbiAgICAgICAgaWYgKHRoaXMuX29wdGlvbnMuZGVsZXRlKSB7XG4gICAgICAgICAgICAvLyBsaXN0ZW4gZm9yIGNsaWNrIGV2ZW50cyBvbiByb290IGVsZW1lbnRcbiAgICAgICAgICAgIGVsZW0uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChlKSA9PiB7XG4gICAgICAgICAgICAgICAgLy8gY2F0Y2ggY2xpY2sgZXZlbnQgZnJvbSBkZWxldGUgYnV0dG9uXG4gICAgICAgICAgICAgICAgY29uc3QgZGVsZXRlQnRuID0gZS50YXJnZXQuY2xvc2VzdChcIiNkZWxldGVcIik7XG4gICAgICAgICAgICAgICAgaWYgKGRlbGV0ZUJ0bikge1xuICAgICAgICAgICAgICAgICAgICBjb25zdCBsaXN0SXRlbSA9IGRlbGV0ZUJ0bi5jbG9zZXN0KFwiLmxpc3QtaXRlbVwiKTtcbiAgICAgICAgICAgICAgICAgICAgaWYgKGxpc3RJdGVtKSB7XG4gICAgICAgICAgICAgICAgICAgICAgICB0aGlzLl9kcy51cGRhdGUoe3JlbW92ZTpbbGlzdEl0ZW0uaWRdfSk7XG4gICAgICAgICAgICAgICAgICAgICAgICBlLnN0b3BQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfb25jaGFuZ2UoZGlmZnMpIHtcbiAgICAgICAgY29uc3Qge3RvU3RyaW5nfSA9IHRoaXMuX29wdGlvbnM7XG4gICAgICAgIGZvciAobGV0IGRpZmYgb2YgZGlmZnMpIHtcbiAgICAgICAgICAgIGlmIChkaWZmLm5ldykge1xuICAgICAgICAgICAgICAgIC8vIGFkZFxuICAgICAgICAgICAgICAgIGxldCBub2RlID0gdGhpcy5fZWxlbS5xdWVyeVNlbGVjdG9yKGAjJHtkaWZmLmlkfWApO1xuICAgICAgICAgICAgICAgIGlmIChub2RlID09IG51bGwpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJkaXZcIik7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuc2V0QXR0cmlidXRlKFwiaWRcIiwgZGlmZi5pZCk7XG4gICAgICAgICAgICAgICAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChcImxpc3QtaXRlbVwiKTtcbiAgICAgICAgICAgICAgICAgICAgdGhpcy5fZWxlbS5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgbm9kZS5pbm5lckhUTUwgPSB0b1N0cmluZyhkaWZmLm5ldyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKGRpZmYub2xkKSB7XG4gICAgICAgICAgICAgICAgLy8gcmVtb3ZlXG4gICAgICAgICAgICAgICAgbGV0IG5vZGUgPSB0aGlzLl9lbGVtLnF1ZXJ5U2VsZWN0b3IoYCMke2RpZmYuaWR9YCk7XG4gICAgICAgICAgICAgICAgaWYgKG5vZGUpIHtcbiAgICAgICAgICAgICAgICAgICAgbm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cbn1cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7SUFBQTtJQUNBO0lBQ0E7SUFDQTtJQUNBOztJQUVPLFNBQVMsaUJBQWlCLEdBQUc7SUFDcEMsSUFBSSxJQUFJLFFBQVE7SUFDaEIsSUFBSSxJQUFJLE9BQU8sR0FBRyxJQUFJLE9BQU8sQ0FBQyxDQUFDLE9BQU8sRUFBRSxNQUFNLEtBQUs7SUFDbkQsUUFBUSxRQUFRLEdBQUcsT0FBTztJQUMxQixLQUFLLENBQUM7SUFDTixJQUFJLE9BQU8sQ0FBQyxPQUFPLEVBQUUsUUFBUSxDQUFDO0lBQzlCOzs7SUFtQk8sU0FBUyxhQUFhLENBQUMsTUFBTSxFQUFFO0lBQ3RDLElBQUksSUFBSSxJQUFJLEdBQUcsRUFBRTtJQUNqQixJQUFJLElBQUksUUFBUSxHQUFHLHNEQUFzRDtJQUN6RSxJQUFJLElBQUksSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUU7SUFDcEMsUUFBUSxJQUFJLElBQUksUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUMsS0FBSyxD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R0FBRyxDQUFDO0lBQzFDLFlBQVksTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLElBQUksU0FBUyxJQUFJLElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDO0lBQzNFO0lBQ0EsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDO0lBQ3BDO0lBQ0EsWUFBWSxRQUFRLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDLEVBQUUsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksRUFBRSxHQUFHLENBQUMsQ0FBQztJQUN0RDtJQUNBLFFBQVEsSUFBSSxDQUFDLGlCQUFpQixDQUFDLENBQUMsR0FBRyxRQUFRLENBQUMsTUFBTSxFQUFFLENBQUMsQ0FBQztJQUN0RDs7SUFFQSxJQUFJLGlCQUFpQixDQUFDLENBQUMsSUFBSSxFQUFFO0lBQzdCLFFBQVEsSUFBSSxDQUFDLFNBQVMsQ0FBQyxPQUFPLENBQUMsU0FBUyxNQUFNLEVBQUU7SUFDaEQsWUFBWSxNQUFNLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQztJQUNoQyxTQUFTLENBQUM7SUFDVixLQUFLOztJQUVMO0lBQ0E7SUFDQTs7SUFFQTtJQUNBO0lBQ0E7SUFDQSxJQUFJLFNBQVMsR0FBRztJQUNoQixRQUFRLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsTUFBTSxFQUFFLENBQUM7SUFDdEMsS0FBSztJQUNMLElBQUksSUFBSSxJQUFJLEdBQUcsQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDO0lBQ3RDLElBQUksUUFBUSxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsT0FBTyxJQUFJLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQztJQUM1QyxJQUFJLFFBQVEsQ0FBQyxFQUFFLEVBQUUsQ0FBQyxPQUFPLElBQUksQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQzs7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QUNuRTs7SUFFQTs7SUFFQSxJQUFJLE1BQU0sQ0FBQyxDQUFDLElBQUksRUFBRTtJQUNsQjtJQUNBLFFBQVEsTUFBTSxRQUFRLEdBQUcsSUFBSSxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxTQUFTLENBQUMsQ0FBQztJQUNyRDtJQUNBLFFBQVEsUUFBUSxDQUFDLE1BQU0sQ0FBQyxJQUFJO0lBQzVCO0lBQ0EsUUFBUSxNQUFNLEtBQUssR0FBRyxDQUFDLEdBQUcsUUFBUSxDQUFDLE9BQU8sRUFBRSxDQUFDO0lBQzdDLFFBQVEsT0FBTyxJQUFJLENBQUMsTUFBTSxDQUFDLE9BQU8sRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQy9EOztJQUVBO0lBQ0E7SUFDQTs7SUFFQTtJQUNBLElBQUksR0FBRyxDQUFDLElBQUksRUFBRTtJQUNkLFFBQVEsT0FBTyxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxHQUFHLEVBQUUsSUFBSSxDQUFDO0lBQzlDO0lBQ0E7SUFDQTtJQUNBLElBQUksTUFBTSxDQUFDLElBQUksRUFBRSxPQUFPLEVBQUU7SUFDMUIsUUFBUSxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFDLEdBQUcsRUFBRSxJQUFJLEVBQUUsT0FBTyxDQUFDO0lBQ3ZEOztJQUVBO0lBQ0E7SUFDQTtJQUNBOztJQUVBLElBQUksZUFBZSxDQUFDLENBQUMsSUFBSSxFQUFFLE9BQU8sRUFBRTtJQUNwQztJQUNBLFFBQVEsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFO0lBQ3ZDO0lBQ0EsWUFBWSxJQUFJLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQztJQUMzQjtJQUNBO0lBQ0EsUUFBUSxJQUFJLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUU7SUFDckMsWUFBWSxJQUFJLENBQUMsT0FBTyxDQUFDLEdBQUcsQ0FBQyxJQUFJLEVB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
