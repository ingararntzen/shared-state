
(function(l, r) { if (!l || l.getElementById('livereloadscript')) return; r = l.createElement('script'); r.async = 1; r.src = '//' + (self.location.host || 'localhost').split(':')[0] + ':35729/livereload.js?snipver=1'; r.id = 'livereloadscript'; l.getElementsByTagName('head')[0].appendChild(r) })(self.document);
var DATACANNON = (function (exports) {
    'use strict';

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
        DELETE: "DELETE",
        RESET: "RESET",
        NOTIFY: "NOTIFY"
    });


    class DataCannonClient extends WebSocketIO {

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
                this.reset("/subs", [...this._subs_map.entries()]);
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
            this._ds_map.get(msg["path"]);
        }

        _handle_notify(msg) {
            // update dataset state
            console.log("notify", msg["path"], msg["data"]);
            this._ds_map.get(msg["path"]);
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
                    this._subs_map = new Map(data);
                }
                return {ok, data, path, arg};
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
            subs_map.delete(path);
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

    exports.DataCannonClient = DataCannonClient;

    return exports;

})({});
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGF0YWNhbm5vbi5paWZlLmpzIiwic291cmNlcyI6WyIuLi8uLi9zcmMvY2xpZW50L3V0aWwuanMiLCIuLi8uLi9zcmMvY2xpZW50L3dzaW8uanMiLCIuLi8uLi9zcmMvY2xpZW50L2RhdGFjYW5ub24uanMiXSwic291cmNlc0NvbnRlbnQiOlsiLypcbiAgICBDcmVhdGUgYSBwcm9taXNlIHdoaWNoIGNhbiBiZSByZXNvbHZlZFxuICAgIHByb2dyYW1tYXRpY2FsbHkgYnkgZXh0ZXJuYWwgY29kZS5cbiAgICBSZXR1cm4gYSBwcm9taXNlIGFuZCBhIHJlc29sdmUgZnVuY3Rpb25cbiovXG5cbmV4cG9ydCBmdW5jdGlvbiByZXNvbHZhYmxlUHJvbWlzZSgpIHtcbiAgICBsZXQgcmVzb2x2ZXI7XG4gICAgbGV0IHByb21pc2UgPSBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICAgIHJlc29sdmVyID0gcmVzb2x2ZTtcbiAgICB9KTtcbiAgICByZXR1cm4gW3Byb21pc2UsIHJlc29sdmVyXTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIHRpbWVvdXRQcm9taXNlIChtcykge1xuICAgIGxldCByZXNvbHZlcjtcbiAgICBsZXQgcHJvbWlzZSA9IG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgICAgbGV0IHRpZCA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgcmVzb2x2ZSh0cnVlKTtcbiAgICAgICAgfSwgbXMpO1xuICAgICAgICByZXNvbHZlciA9ICgpID0+IHtcbiAgICAgICAgICAgIGlmICh0aWQpIHtcbiAgICAgICAgICAgICAgICBjbGVhclRpbWVvdXQodGlkKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xuICAgICAgICB9XG4gICAgfSk7XG4gICAgcmV0dXJuIFtwcm9taXNlLCByZXNvbHZlcl07XG59IiwiaW1wb3J0IHsgcmVzb2x2YWJsZVByb21pc2UgfSBmcm9tIFwiLi91dGlsLmpzXCI7XG5cbmNvbnN0IE1BWF9SRVRSSUVTID0gNDtcblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldElPIHtcblxuICAgIGNvbnN0cnVjdG9yKHVybCwgb3B0aW9ucz17fSkge1xuICAgICAgICB0aGlzLl91cmwgPSB1cmw7XG4gICAgICAgIHRoaXMuX3dzO1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IGZhbHNlO1xuICAgICAgICB0aGlzLl9vcHRpb25zID0gb3B0aW9ucztcbiAgICAgICAgdGhpcy5fcmV0cmllcyA9IDA7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMgPSBbXTtcbiAgICB9XG5cbiAgICBnZXQgY29ubmVjdGluZygpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGluZzt9XG4gICAgZ2V0IGNvbm5lY3RlZCgpIHtyZXR1cm4gdGhpcy5fY29ubmVjdGVkO31cbiAgICBnZXQgdXJsKCkge3JldHVybiB0aGlzLl91cmw7fVxuICAgIGdldCBvcHRpb25zKCkge3JldHVybiB0aGlzLl9vcHRpb25zO31cblxuICAgIGNvbm5lY3QoKSB7XG5cbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGluZyB8fCB0aGlzLmNvbm5lY3RlZCkge1xuICAgICAgICAgICAgY29uc29sZS5sb2coXCJDb25uZWN0IHdoaWxlIGNvbm5lY3Rpbmcgb3IgY29ubmVjdGVkXCIpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKFwiVGVybWluYXRlZFwiKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIGNvbm5lY3RpbmdcbiAgICAgICAgdGhpcy5fd3MgPSBuZXcgV2ViU29ja2V0KHRoaXMuX3VybCk7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSBlID0+IHRoaXMuX29uX29wZW4oZSk7XG4gICAgICAgIHRoaXMuX3dzLm9ubWVzc2FnZSA9IGUgPT4gdGhpcy5vbl9tZXNzYWdlKGUuZGF0YSk7XG4gICAgICAgIHRoaXMuX3dzLm9uY2xvc2UgPSBlID0+IHRoaXMuX29uX2Nsb3NlKGUpO1xuICAgICAgICB0aGlzLl93cy5vbmVycm9yID0gZSA9PiB0aGlzLm9uX2Vycm9yKGUpO1xuICAgICAgICB0aGlzLm9uX2Nvbm5lY3RpbmcoKTtcbiAgICB9XG5cbiAgICBfb25fb3BlbihldmVudCkge1xuICAgICAgICB0aGlzLl9jb25uZWN0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgIC8vIHJlbGVhc2UgY29ubmVjdCBwcm9taXNlc1xuICAgICAgICBmb3IgKGNvbnN0IHJlc29sdmVyIG9mIHRoaXMuX2Nvbm5lY3RfcHJvbWlzZV9yZXNvbHZlcnMpIHtcbiAgICAgICAgICAgIHJlc29sdmVyKCk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycyA9IFtdO1xuICAgICAgICAvLyByZXNldCByZXRyaWVzIG9uIHN1Y2Nlc3NmdWwgY29ubmVjdGlvblxuICAgICAgICB0aGlzLl9yZXRyaWVzID0gMDtcbiAgICAgICAgdGhpcy5vbl9jb25uZWN0KCk7XG4gICAgfVxuXG4gICAgX29uX2Nsb3NlKGV2ZW50KSB7XG4gICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgdGhpcy5fY29ubmVjdGVkID0gZmFsc2U7XG4gICAgICAgIHRoaXMub25fZGlzY29ubmVjdChldmVudCk7XG4gICAgICAgIHRoaXMuX3JldHJpZXMgKz0gMTtcbiAgICAgICAgaWYgKCF0aGlzLl9pc190ZXJtaW5hdGVkKCkpIHtcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICAgICAgICAgIHRoaXMuY29ubmVjdCgpO1xuICAgICAgICAgICAgfSwgMTAwMCAqIHRoaXMuX3JldHJpZXMpO1xuICAgICAgICB9O1xuICAgIH1cblxuICAgIF9pc190ZXJtaW5hdGVkKCkge1xuICAgICAgICBjb25zdCB7cmV0cmllcz1NQVhfUkVUUklFU30gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAodGhpcy5fcmV0cmllcyA+PSByZXRyaWVzKSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgVGVybWluYXRlZDogTWF4IHJldHJpZXMgcmVhY2hlZCAoJHtyZXRyaWVzfSlgKTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RpbmcgPSBmYWxzZTtcbiAgICAgICAgICAgIHRoaXMuX2Nvbm5lY3RlZCA9IHRydWU7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm9wZW4gPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbm1lc3NhZ2UgPSB1bmRlZmluZWQ7XG4gICAgICAgICAgICB0aGlzLl93cy5vbmNsb3NlID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgdGhpcy5fd3Mub25lcnJvciA9IHVuZGVmaW5lZDtcbiAgICAgICAgICAgIHRoaXMuX3dzID0gdW5kZWZpbmVkO1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIG9uX2Nvbm5lY3RpbmcoKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29ubmVjdGluZyAke3RoaXMudXJsfWApO31cbiAgICB9XG4gICAgb25fY29ubmVjdCgpIHtcbiAgICAgICAgY29uc29sZS5sb2coYENvbm5lY3QgICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgRXJyb3I6ICR7ZXJyb3J9YCk7fVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KGV2ZW50KSB7XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYERpc2Nvbm5lY3QgJHt0aGlzLnVybH1gKTtcbiAgICB9XG4gICAgb25fbWVzc2FnZShkYXRhKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgUmVjZWl2ZTogJHtkYXRhfWApO31cbiAgICB9XG5cbiAgICBzZW5kKGRhdGEpIHtcbiAgICAgICAgaWYgKHRoaXMuX2Nvbm5lY3RlZCkge1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICB0aGlzLl93cy5zZW5kKGRhdGEpO1xuICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBTZW5kIGZhaWw6ICR7ZXJyb3J9YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgU2VuZCBkcm9wIDogbm90IGNvbm5lY3RlZGApXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBjb25uZWN0ZWRQcm9taXNlKCkge1xuICAgICAgICBjb25zdCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgaWYgKHRoaXMuY29ubmVjdGVkKSB7XG4gICAgICAgICAgICByZXNvbHZlcigpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgdGhpcy5fY29ubmVjdF9wcm9taXNlX3Jlc29sdmVycy5wdXNoKHJlc29sdmVyKTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gcHJvbWlzZTtcbiAgICB9XG59XG5cblxuIiwiaW1wb3J0IHsgV2ViU29ja2V0SU8gfSBmcm9tIFwiLi93c2lvLmpzXCI7XG5pbXBvcnQgeyByZXNvbHZhYmxlUHJvbWlzZSB9IGZyb20gXCIuL3V0aWwuanNcIjtcblxuXG5jb25zdCBNc2dUeXBlID0gT2JqZWN0LmZyZWV6ZSh7XG4gICAgTUVTU0FHRSA6IFwiTUVTU0FHRVwiLFxuICAgIFJFUVVFU1Q6IFwiUkVRVUVTVFwiLFxuICAgIFJFUExZOiBcIlJFUExZXCJcbiB9KTtcbiBcbmNvbnN0IE1zZ0NtZCA9IE9iamVjdC5mcmVlemUoe1xuICAgIEdFVCA6IFwiR0VUXCIsXG4gICAgUFVUOiBcIlBVVFwiLFxuICAgIERFTEVURTogXCJERUxFVEVcIixcbiAgICBSRVNFVDogXCJSRVNFVFwiLFxuICAgIE5PVElGWTogXCJOT1RJRllcIlxufSk7XG5cblxuZXhwb3J0IGNsYXNzIERhdGFDYW5ub25DbGllbnQgZXh0ZW5kcyBXZWJTb2NrZXRJTyB7XG5cbiAgICBjb25zdHJ1Y3RvciAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIHN1cGVyKHVybCwgb3B0aW9ucyk7XG5cbiAgICAgICAgLy8gcmVxdWVzdHNcbiAgICAgICAgdGhpcy5fcmVxaWQgPSAwO1xuICAgICAgICB0aGlzLl9wZW5kaW5nID0gbmV3IE1hcCgpO1xuXG4gICAgICAgIC8vIHN1YnNjcmlwdGlvbnNcbiAgICAgICAgLy8gcGF0aCAtPiB7fSBcbiAgICAgICAgdGhpcy5fc3Vic19tYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgICAgLy8gZGF0YXNldHNcbiAgICAgICAgLy8gcGF0aCAtPiBkc1xuICAgICAgICB0aGlzLl9kc19tYXAgPSBuZXcgTWFwKCk7XG4gICAgICAgIHRoaXMuX2RzX2hhbmRsZV9tYXAgPSBuZXcgTWFwKCk7XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBDT05ORUNUSU9OIFxuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX2Nvbm5lY3QoKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKGBDb25uZWN0ICAke3RoaXMudXJsfWApO1xuICAgICAgICAvLyByZWZyZXNoIGxvY2FsIHN1c2NyaXB0aW9uc1xuICAgICAgICBpZiAodGhpcy5fc3Vic19tYXAuc2l6ZSA+IDApIHtcbiAgICAgICAgICAgIHRoaXMucmVzZXQoXCIvc3Vic1wiLCBbLi4udGhpcy5fc3Vic19tYXAuZW50cmllcygpXSlcbiAgICAgICAgfVxuICAgIH1cbiAgICBvbl9kaXNjb25uZWN0KCkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGBEaXNjb25uZWN0ICR7dGhpcy51cmx9YCk7XG4gICAgfVxuICAgIG9uX2Vycm9yKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IHtkZWJ1Zz1mYWxzZX0gPSB0aGlzLl9vcHRpb25zO1xuICAgICAgICBpZiAoZGVidWcpIHtjb25zb2xlLmxvZyhgQ29tbXVuaWNhdGlvbiBFcnJvcjogJHtlcnJvcn1gKTt9XG4gICAgfVxuXG4gICAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxuICAgICAgICBIQU5ETEVSU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIG9uX21lc3NhZ2UoZGF0YSkge1xuICAgICAgICBsZXQgbXNnID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgICAgICAgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuUkVQTFkpIHtcbiAgICAgICAgICAgIGxldCByZXFpZCA9IG1zZy50dW5uZWw7XG4gICAgICAgICAgICBpZiAodGhpcy5fcGVuZGluZy5oYXMocmVxaWQpKSB7XG4gICAgICAgICAgICAgICAgbGV0IHJlc29sdmVyID0gdGhpcy5fcGVuZGluZy5nZXQocmVxaWQpO1xuICAgICAgICAgICAgICAgIHRoaXMuX3BlbmRpbmcuZGVsZXRlKHJlcWlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCB7b2ssIGRhdGF9ID0gbXNnO1xuICAgICAgICAgICAgICAgIHJlc29sdmVyKHtvaywgZGF0YX0pO1xuICAgICAgICAgICAgfVxuICAgICAgICB9IGVsc2UgaWYgKG1zZy50eXBlID09IE1zZ1R5cGUuTUVTU0FHRSkge1xuICAgICAgICAgICAgaWYgKG1zZy5jbWQgPT0gTXNnQ21kLlJFU0VUKSB7XG4gICAgICAgICAgICAgICAgdGhpcy5faGFuZGxlX3Jlc2V0KG1zZyk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKG1zZy5jbWQgPT0gTXNnQ21kLk5PVElGWSkge1xuICAgICAgICAgICAgICAgIHRoaXMuX2hhbmRsZV9ub3RpZnkobXNnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgIH1cblxuICAgIF9oYW5kbGVfcmVzZXQobXNnKSB7XG4gICAgICAgIC8vIHNldCBkYXRhc2V0IHN0YXRlXG4gICAgICAgIGNvbnNvbGUubG9nKFwicmVzZXRcIiwgbXNnW1wicGF0aFwiXSwgbXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fZHNfbWFwLmdldChtc2dbXCJwYXRoXCJdKTtcbiAgICAgICAgaWYgKGRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gZHMucmVzZXQobXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIH1cbiAgICB9XG5cbiAgICBfaGFuZGxlX25vdGlmeShtc2cpIHtcbiAgICAgICAgLy8gdXBkYXRlIGRhdGFzZXQgc3RhdGVcbiAgICAgICAgY29uc29sZS5sb2coXCJub3RpZnlcIiwgbXNnW1wicGF0aFwiXSwgbXNnW1wiZGF0YVwiXSk7XG4gICAgICAgIGNvbnN0IGRzID0gdGhpcy5fZHNfbWFwLmdldChtc2dbXCJwYXRoXCJdKTtcbiAgICAgICAgaWYgKGRzICE9IHVuZGVmaW5lZCkge1xuICAgICAgICAgICAgLy8gZHMudXBkYXRlKG1zZ1tcImRhdGFcIl0pXG4gICAgICAgIH1cbiAgICB9XG5cbiAgICAvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXG4gICAgICAgIFNFUlZFUiBSRVFVRVNUU1xuICAgICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cblxuICAgIF9yZXF1ZXN0KGNtZCwgcGF0aCwgYXJnKSB7XG4gICAgICAgIGNvbnN0IHJlcWlkID0gdGhpcy5fcmVxaWQrKztcbiAgICAgICAgY29uc3QgbXNnID0ge1xuICAgICAgICAgICAgdHlwZTogTXNnVHlwZS5SRVFVRVNULFxuICAgICAgICAgICAgY21kLCBcbiAgICAgICAgICAgIHBhdGgsIFxuICAgICAgICAgICAgYXJnLFxuICAgICAgICAgICAgdHVubmVsOiByZXFpZFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnNlbmQoSlNPTi5zdHJpbmdpZnkobXNnKSk7XG4gICAgICAgIGxldCBbcHJvbWlzZSwgcmVzb2x2ZXJdID0gcmVzb2x2YWJsZVByb21pc2UoKTtcbiAgICAgICAgdGhpcy5fcGVuZGluZy5zZXQocmVxaWQsIHJlc29sdmVyKTtcbiAgICAgICAgcmV0dXJuIHByb21pc2UudGhlbigoe29rLCBkYXRhfSkgPT4ge1xuICAgICAgICAgICAgLy8gc3BlY2lhbCBoYW5kbGluZyBmb3IgcmVwbGllcyB0byBQVVQgL3N1YnNcbiAgICAgICAgICAgIGlmIChjbWQgPT0gTXNnQ21kLlBVVCAmJiBwYXRoID09IFwiL3N1YnNcIiAmJiBvaykge1xuICAgICAgICAgICAgICAgIC8vIHVwZGF0ZSBsb2NhbCBzdWJzY3JpcHRpb24gc3RhdGVcbiAgICAgICAgICAgICAgICB0aGlzLl9zdWJzX21hcCA9IG5ldyBNYXAoZGF0YSlcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHJldHVybiB7b2ssIGRhdGEsIHBhdGgsIGFyZ307XG4gICAgICAgIH0pO1xuICAgIH1cblxuICAgIF9zdWIgKHBhdGgpIHtcbiAgICAgICAgLy8gY29weSBjdXJyZW50IHN0YXRlIG9mIHN1YnNcbiAgICAgICAgY29uc3Qgc3Vic19tYXAgPSBuZXcgTWFwKFsuLi50aGlzLl9zdWJzX21hcF0pO1xuICAgICAgICAvLyBzZXQgbmV3IHBhdGhcbiAgICAgICAgc3Vic19tYXAuc2V0KHBhdGgsIHt9KTtcbiAgICAgICAgLy8gcmVzZXQgc3VicyBvbiBzZXJ2ZXJcbiAgICAgICAgcmV0dXJuIHRoaXMucmVzZXQoXCIvc3Vic1wiLCBbLi4uc3Vic19tYXAuZW50cmllcygpXSk7XG4gICAgfVxuXG4gICAgX3Vuc3ViIChwYXRoKSB7XG4gICAgICAgIC8vIGNvcHkgY3VycmVudCBzdGF0ZSBvZiBzdWJzXG4gICAgICAgIGNvbnN0IHN1YnNfbWFwID0gbmV3IE1hcChbLi4udGhpcy5fc3Vic19tYXBdKTtcbiAgICAgICAgLy8gcmVtb3ZlIHBhdGhcbiAgICAgICAgc3Vic19tYXAuZGVsZXRlKHBhdGgpXG4gICAgICAgIC8vIHJlc2V0IHN1YnMgb24gc2VydmVyXG4gICAgICAgIHJldHVybiB0aGlzLnJlc2V0KFwiL3N1YnNcIiwgWy4uLnN1YnNfbWFwLmVudHJpZXMoKV0pO1xuICAgIH1cblxuICAgIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcbiAgICAgICAgQVBJXG4gICAgKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xuXG4gICAgZ2V0KHBhdGgpIHtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLkdFVCwgcGF0aCk7XG4gICAgfVxuICAgIFxuICAgIHJlc2V0KHBhdGgsIGluc2VydCkge1xuICAgICAgICBjb25zdCBhcmc9IHttZXRob2Q6XCJyZXNldFwiLCBhcmdzOmluc2VydH07XG4gICAgICAgIHJldHVybiB0aGlzLl9yZXF1ZXN0KE1zZ0NtZC5QVVQsIHBhdGgsIGFyZyk7XG4gICAgfVxuXG4gICAgdXBkYXRlKHBhdGgsIHJlbW92ZSwgaW5zZXJ0KSB7XG4gICAgICAgIGNvbnN0IGFyZyA9IHttZXRob2Q6XCJ1cGRhdGVcIiwgYXJnczpbcmVtb3ZlLCBpbnNlcnRdfTtcbiAgICAgICAgcmV0dXJuIHRoaXMuX3JlcXVlc3QoTXNnQ21kLlBVVCwgcGF0aCwgYXJnKTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiBhY3F1aXJlIGRhdGFzZXQgZm9yIHBhdGhcbiAgICAgKiAtIGF1dG9tYXRpY2FsbHkgc3Vic2NyaWJlcyB0byBwYXRoIGlmIG5lZWRlZFxuICAgICAqIHJldHVybnMgaGFuZGxlIGFuZCBkYXRhc2V0XG4gICAgICogaGFuZGxlIHVzZWQgdG8gcmVsZWFzZSBkYXRhc2V0XG4gICAgICovXG5cbiAgICBhY3F1aXJlIChwYXRoKSB7XG4gICAgICAgIC8vIHN1YnNjcmliZSBpZiBub3QgZXhpc3RzXG4gICAgICAgIGlmICghdGhpcy5fc3Vic19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICAvLyBzdWJzY3JpYmUgdG8gcGF0aFxuICAgICAgICAgICAgdGhpcy5fc3ViKHBhdGgpO1xuICAgICAgICB9XG4gICAgICAgIC8vIGNyZWF0ZSBkYXRhc2V0IGlmIG5vdCBleGlzdHNcbiAgICAgICAgaWYgKCF0aGlzLl9kc19tYXAuaGFzKHBhdGgpKSB7XG4gICAgICAgICAgICB0aGlzLl9kc19tYXAuc2V0KHBhdGgsIG5ldyBPYmplY3QoKSk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZHMgPSB0aGlzLl9kc19tYXAuZ2V0KHBhdGgpO1xuICAgICAgICAvLyBjcmVhdGUgaGFuZGxlIGZvciBwYXRoXG4gICAgICAgIGNvbnN0IGhhbmRsZSA9IHtwYXRofTtcbiAgICAgICAgaWYgKCF0aGlzLl9kc19oYW5kbGVfbWFwLmhhcyhwYXRoKSkge1xuICAgICAgICAgICAgdGhpcy5fZHNfaGFuZGxlX21hcC5zZXQocGF0aCwgW10pO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMuX2RzX2hhbmRsZV9tYXAuZ2V0KHBhdGgpLnB1c2goaGFuZGxlKTtcbiAgICAgICAgcmV0dXJuIFtoYW5kbGUsIGRzXTtcbiAgICB9XG5cbiAgICAvKipcbiAgICAgKiByZWxlYXNlIGRhdGFzZXQgYnkgaGFuZGxlXG4gICAgICogLSBhdXRvbWF0aWNhbGx5IHVuc3Vic2NyaWJlIGlmIGFsbCBoYW5kbGVzIGhhdmUgYmVlbiByZWxlYXNlZFxuICAgICAqL1xuXG4gICAgcmVsZWFzZSAoaGFuZGxlKSB7XG4gICAgICAgIGNvbnN0IHBhdGggPSBoYW5kbGUucGF0aDtcbiAgICAgICAgY29uc3QgaGFuZGxlcyA9IHRoaXMuX2RzX2hhbmRsZV9tYXAuZ2V0KHBhdGgpO1xuICAgICAgICBpZiAoaGFuZGxlcyA9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAvLyByZW1vdmUgaGFuZGxlXG4gICAgICAgIGNvbnN0IGluZGV4ID0gaGFuZGxlcy5pbmRleE9mKGhhbmRsZSk7XG4gICAgICAgIGlmIChpbmRleCA+IC0xKSB7XG4gICAgICAgICAgICBoYW5kbGVzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIH1cbiAgICAgICAgLy8gY2xlYW4gdXAgaWYgbGFzdCBoYW5kbGUgcmVsZWFzZWRcbiAgICAgICAgaWYgKGhhbmRsZXMubGVuZ3RoID09IDApIHtcbiAgICAgICAgICAgIHRoaXMuX3Vuc3ViKHBhdGgpO1xuICAgICAgICAgICAgLy8gY2xlYXIvZGlzYWJsZSBkYXRhc2V0XG4gICAgICAgICAgICAvLyBjb25zdCBkcyA9IHRoaXMuX2RzX21hcC5nZXQocGF0aCk7XG4gICAgICAgICAgICB0aGlzLl9kc19tYXAuZGVsZXRlKHBhdGgpO1xuICAgICAgICB9XG4gICAgfVxufVxuXG5cbiJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoi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QUMsTUFBTSxFQUFFO0lBQ3JCLFFBQVEsTUFBTSxJQUFJLEdBQUcsTUFBTSxDQUFDLElBQUk7SUFDaEMsUUFBUSxNQUFNLE9BQU8sR0FBRyxJQUFJLENBQUMsY0FBYyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUM7SUFDckQsUUFBUSxJQUFJLE9BQU8sSUFBSSxTQUFTLEVBQUU7SUFDbEMsWUFBWTtJQUNaO0lBQ0E7SUFDQSxRQUFRLE1BQU0sS0FBSyxHQUFHLE9BQU8sQ0FBQyxPQUFPLENBQUMsTUFBTSxDQUFDO0lBQzdDLFFBQVEsSUFBSSxLQUFLLEdBQUcsRUFBRSxFQUFFO0lBQ3hCLFlBQVksT0FBTyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQyxDQUFDO0lBQ3BDO0lBQ0E7SUFDQSxRQUFRLElBQUksT0FBTyxDQUFDLE1BQU0sSUFBSSxDQUFDLEVBQUU7SUFDakMsWUFBWSxJQUFJLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQztJQUM3QjtJQUNBO0lBQ0EsWUFBWSxJQUFJLENBQUMsT0FBTyxDQUFDLE1BQU0sQ0FBQyxJQUFJLENBQUM7SUFDckM7SUFDQTtJQUNBOzs7Ozs7Ozs7OyJ9
