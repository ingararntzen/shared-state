import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";
import { Collection } from "./collection.js";
import { Variable } from "./variable.js";
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
            var_map.set(name, new Variable(ds, name, options))
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


