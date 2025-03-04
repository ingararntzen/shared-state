import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";


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


export class DataCannonClient extends WebSocketIO {

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
            this.reset("/subs", [...this._subs_map.entries()])
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
        console.log("reset", msg["path"], msg["data"]);
        const ds = this._ds_map.get(msg["path"]);
        if (ds != undefined) {
            // ds.reset(msg["data"]);
        }
    }

    _handle_notify(msg) {
        // update dataset state
        console.log("notify", msg["path"], msg["data"]);
        const ds = this._ds_map.get(msg["path"]);
        if (ds != undefined) {
            // ds.update(msg["data"])
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
        // copy current state of subs
        const subs_map = new Map([...this._subs_map]);
        // set new path
        subs_map.set(path, {});
        // reset subs on server
        return this.reset("/subs", [...subs_map.entries()]);
    }

    _unsub (path) {
        // copy current state of subs
        const subs_map = new Map([...this._subs_map]);
        // remove path
        subs_map.delete(path)
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
            this._ds_map.set(path, new Object());
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


