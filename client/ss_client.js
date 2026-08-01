import { WebSocketIO, ConnectionState } from "./wsio.js";
import { resolvablePromise } from "./util.js";
import { ProxyCollection } from "./ss_collection.js";
import { ProxyObject } from "./ss_object.js";
import { ServerClock, CLOCK } from "./ss_clock.js";

const MsgType = Object.freeze({
    MESSAGE: "MESSAGE",
    REQUEST: "REQUEST",
    REPLY: "REPLY"
});

const MsgCmd = Object.freeze({
    GET: "GET",
    PUT: "PUT",
    NOTIFY: "NOTIFY"
});

export class SharedStateClient {

    constructor(url, options) {
        // logical connection instance
        this._connection = new WebSocketIO(url, options);

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
        this._server_clock = undefined;

        // bind connection callbacks
        this._connection.on_connect = () => this._on_connect();
        this._connection.on_disconnect = (event) => this._on_disconnect(event);
        this._connection.on_error = (error) => this._on_error(error);
        this._connection.on_message = (data) => this._on_message(data);

        // initiate connection
        this._connection.connect();
    }

    /*********************************************************************
        ACCESSORS
    *********************************************************************/

    get connection() {
        return this._connection;
    }

    get local_clock() {
        return CLOCK;
    }

    get server_clock() {
        if (this._server_clock === undefined) {
            this._server_clock = new ServerClock(this);
            if (this._connection.state === ConnectionState.CONNECTED) {
                this._server_clock.restart();
            }
        }
        return this._server_clock;
    }

    /*********************************************************************
        CONNECTION HANDLERS
    *********************************************************************/

    _on_connect() {
        console.log(`Connect  ${this._connection.url}`);
        // refresh local subscriptions
        if (this._subs_map.size > 0) {
            const items = [...this._subs_map.entries()];
            this.update("/subs", { insert: items, reset: true });
        }
        // server clock
        if (this._server_clock !== undefined) {
            this._server_clock.restart();
        }
    }

    _on_disconnect(event) {
        console.error(`Disconnect ${this._connection.url}`);
        // server clock
        if (this._server_clock !== undefined) {
            this._server_clock.pinger.pause();
        }
    }

    _on_error(error) {
        const { debug = false } = this._connection.options;
        if (debug) { console.log(`Communication Error: ${error}`); }
    }

    _on_message(data) {
        let msg = JSON.parse(data);
        if (msg.type === MsgType.REPLY) {
            let reqid = msg.tunnel;
            if (this._pending.has(reqid)) {
                let resolver = this._pending.get(reqid);
                this._pending.delete(reqid);
                const { ok, data } = msg;
                resolver({ ok, data });
            }
        } else if (msg.type === MsgType.MESSAGE) {
            if (msg.cmd === MsgCmd.NOTIFY) {
                this._handle_notify(msg);
            }
        }
    }

    _handle_notify(msg) {
        const ds = this._coll_map.get(msg["path"]);
        if (ds !== undefined) {
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
        this._connection.send(JSON.stringify(msg));
        let [promise, resolver] = resolvablePromise();
        this._pending.set(reqid, resolver);
        return promise.then(({ ok, data }) => {
            if (cmd === MsgCmd.PUT && path === "/subs" && ok) {
                this._subs_map = new Map(data);
            }
            return { ok, path, data };
        });
    }

    _sub(path) {
        if (this._connection.state === ConnectionState.CONNECTED) {
            const subs_map = new Map([...this._subs_map]);
            subs_map.set(path, {});
            const items = [...subs_map.entries()];
            return this.update("/subs", { insert: items, reset: true });
        } else {
            this._subs_map.set(path, {});
            return Promise.resolve({ ok: true, path, data: undefined });
        }
    }

    _unsub(path) {
        const subs_map = new Map([...this._subs_map]);
        subs_map.delete(path);
        const items = [...subs_map.entries()];
        return this.update("/subs", { insert: items, reset: true });
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

    acquire_collection(path, options) {
        path = path.startsWith("/") ? path : "/" + path;
        if (!this._subs_map.has(path)) {
            this._sub(path);
        }
        if (!this._coll_map.has(path)) {
            this._coll_map.set(path, new ProxyCollection(this, path, options));
        }
        return this._coll_map.get(path);
    }

    acquire_object(path, name, options) {
        path = path.startsWith("/") ? path : "/" + path;
        const ds = this.acquire_collection(path);
        if (!this._obj_map.has(path)) {
            this._obj_map.set(path, new Map());
        }
        const obj_map = this._obj_map.get(path);
        if (!obj_map.get(name)) {
            obj_map.set(name, new ProxyObject(ds, name, options));
        }
        return obj_map.get(name);
    }

    release(path) {
        if (this._subs_map.has(path)) {
            this._unsub(path);
        }
        const ds = this._coll_map.get(path);
        if (ds !== undefined) {
            ds._ssclient_terminate();
        }
        const obj_map = this._obj_map.get(path);
        if (obj_map !== undefined) {
            for (const v of obj_map.values()) {
                v._ssclient_terminate();
            }
        }
        this._coll_map.delete(path);
        this._obj_map.delete(path);
    }
}
