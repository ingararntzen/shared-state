import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";

export const MsgType = Object.freeze({
    MESSAGE : "MESSAGE",
    REQUEST: "REQUEST",
    REPLY: "REPLY"
 });
 

export const MsgCmd = Object.freeze({
   GET : "GET",
   UPDATE: "UPDATE",
   CLEAR: "CLEAR"
});

export class DataCannonClient extends WebSocketIO {

    constructor (url, options) {
        super(url, options);

        this._reqid = 0;
        this._pending = new Map();
    }

    on_connect() {
        console.log(`Connect  ${this.url}`);
    }
    on_error(error) {
        const {debug=false} = this._options;
        if (debug) {console.log(`Error: ${error}`);}
    }
    on_disconnect() {
        console.error(`Disconnect ${this.url}`);
    }
    on_message(data) {
        let msg = JSON.parse(data);
        if (msg.type == MsgType.REPLY) {
            let reqid = msg.tunnel;
            if (this._pending.has(reqid)) {
                let resolver = this._pending.get(reqid);
                this._pending.delete(reqid);
                const {status, data} = msg;
                resolver({status, data});
            }
        }
    }

    request(cmd, path, args) {
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
        return this.request(MsgCmd.GET, path);
    }

    update (path, args) {
        return this.request(MsgCmd.UPDATE, path, args)
    }

    clear(path) {
        return this.request(MsgCmd.CLEAR, path);
    }

}


