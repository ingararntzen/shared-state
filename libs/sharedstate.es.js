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

export { DatasetViewer, SharedStateClient };
