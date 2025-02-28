import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";

export const MsgType = Object.freeze({
    MESSAGE : "MESSAGE",
    REQUEST: "REQUEST",
    REPLY: "REPLY"
 });
 

export const MsgCmd = Object.freeze({
   GET : "GET",
   PUT: "PUT",
   DELETE: "DELETE"
});

export class DataCannonClient extends WebSocketIO {

    constructor (url, options) {
        super(url, options);

        // requests
        this._reqid = 0;
        this._pending = new Map();

        // subscriptions
        this._subs_map = new Map();
    }

    /*********************************************************************
        CONNECTION 
    *********************************************************************/

    on_connect() {
        console.log(`Connect  ${this.url}`);
        // refresh local suscriptions
        if (this._subs_map.size > 0) {
            this.put_subs([...this._subs_map.entries()])
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
        }
    }


    /*********************************************************************
        SERVER REQUESTS
    *********************************************************************/

    _request(cmd, path, args) {
        const reqid = this._reqid++;
        const msg = {
            type: MsgType.REQUEST,
            cmd, 
            path, 
            args,
            tunnel: reqid
        };
        this.send(JSON.stringify(msg));
        let [promise, resolver] = resolvablePromise();
        this._pending.set(reqid, resolver);
        return promise;
    }

    get(path) {
        return this._request(MsgCmd.GET, path);
    }

    put (path, args) {
        return this._request(MsgCmd.PUT, path, args)
    }

    delete(path) {
        return this._request(MsgCmd.DELETE, path);
    }

    put_subs (subs) {
        return this.put("/subs", subs).then(({ok, data}) => {
            if (ok) {
                // update local state upon receipt
                this._subs_map = new Map(data)
            }
            return {ok, data};
        });
    }
}


