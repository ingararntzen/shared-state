
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
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

const MsgType = Object.freeze({
    MESSAGE : "MESSAGE",
    REQUEST: "REQUEST",
    REPLY: "REPLY"
 });
 

const MsgCmd = Object.freeze({
   GET : "GET",
   PUT: "PUT",
   DELETE: "DELETE"
});

class DataCannonClient extends WebSocketIO {

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
            this.put("/subs", [...this._subs_map.entries()]);
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
            console.log("msg:", msg);
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
        return promise.then(({ok, data}) => {
            // special handling for replies to PUT /subs
            if (cmd == MsgCmd.PUT && path == "/subs" && ok) {
                // update local subscription state
                this._subs_map = new Map(data);
            }
            return {ok, data, path, args};
        });
    }

    get(path) {
        return this._request(MsgCmd.GET, path);
    }
    put (path, args) {
        return this._request(MsgCmd.PUT, path, args);
    }
    delete(path) {
        return this._request(MsgCmd.DELETE, path);
    }
}

export { DataCannonClient };
