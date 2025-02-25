import { WebSocketIO } from "./wsio.js";
import { resolvablePromise } from "./util.js";

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
        let reqid = msg.tunnel;
        if (this._pending.has(reqid)) {
            let resolver = this._pending.get(reqid);
            this._pending.delete(reqid);
            resolver(msg);
        }
    }

    request(cmd, path, args) {
        const reqid = this._reqid++;
        const msg = {cmd, path, args, tunnel:reqid};
        let data = JSON.stringify(msg)
        this.send(data);
        // make promise
        let [promise, resolver] = resolvablePromise();
        this._pending.set(reqid, resolver);
        return promise;
    }
}


