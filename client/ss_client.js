import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";
import { ProxyCollection } from "./ss_collection.js";
import { ProxyObject } from "./ss_object.js";
import { ServerClock } from "./serverclock.js";

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


export class SharedStateClient extends WebSocketIO {

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
                this._subs_map = new Map(data)
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
        subs_map.delete(path)
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
            obj_map.set(name, new ProxyObject(ds, name, options))
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


