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

export { CollectionViewer, SharedStateClient };
