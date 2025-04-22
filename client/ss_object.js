
/**
 * Proxy Object
 * 
 * Client-side proxy object for a server-side object.
 *
 * Implementation leverages ProxyCollection. As such, the value of the proxy object
 * corresponds to the data property of a single item with *id* within a 
 * specific server-side collection. If no item with *id* exists in the collection, the
 * value of the proxy object is undefined. 
 * 
 * set() and get() methods are used to set and get the value of the proxy object.
 * 
 */

export class ProxyObject {

    constructor(proxyCollection, id, options={}) {
        this._terminiated = false;
        this._coll = proxyCollection;
        this._id = id;
        this._options = options;
        // callback
        this._handlers = [];
        this._handle = this._coll.add_callback(this._onchange.bind(this));
    }

    _onchange(diffs) {
        if (this._terminated) {
            throw new Error("proxy object terminated")
        }
        for (const diff of diffs) {
            if (diff.id == this._id) {
                this.notify_callbacks(diff);
            }
        }
    }

    add_callback (handler) {
        const handle = {handler: handler};
        this._handlers.push(handle);
        return handle;
    };
    
    remove_callback (handle) {
        let index = this._handlers.indexOf(handle);
        if (index > -1) {
            this._handers.splice(index, 1);
        }
    };
    
    notify_callbacks (eArg) {
        this._handlers.forEach(function(handle) {
            handle.handler(eArg);
        });
    };

    
    set (obj) {
        if (this._terminated) {
            throw new Error("proxy object terminated")
        }
        const items = [{id:this._id, data:obj}];
        return this._coll.update({insert:items, reset:false});
    }

    get () {
        if (this._coll.has(this._id)) {
            return this._coll.get(this._id).data;
        } else {
            return undefined;
        }
    }
    
    ss_client_terminate() {
        this._terminated = true;
        this._coll.remove_callback(this._handle);
    }
}