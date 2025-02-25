const MAX_RETRIES = 4;

export class WebSocketIO {

    constructor(url, options={}) {
        this._url = url;
        this._ws;
        this._connecting = false;
        this._connected = false;
        this._retries = 0;
        this._options = options;
    }

    get connecting() {return this._connecting;}
    get connected() {return this._connected;}
    get url() {return this._url;}

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
        };
    }

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
    on_message(msg) {
        const {debug=false} = this._options;
        if (debug) {console.log(`Receive: ${msg}`);}
    }

    send(msg) {
        if (this._connected) {
            try {
                this._ws.send(msg);
            } catch (error) {
                console.error(`Send fail: ${error}`);
            }
        } else {
            console.log(`Send drop : not connected`)
        }
    }
}

