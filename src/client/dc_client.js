import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";
import { Dataset } from "./dataset.js";


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


export class DataCannon extends WebSocketIO {

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


