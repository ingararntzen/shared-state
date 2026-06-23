/**
 * Proxy Object
 * 
 * Client-side proxy object for a server-side object.
 *
 * Implementation leverages ProxyCollection. As such, the value of the proxy object
 * corresponds to the state property of a single item with *id* within a 
 * specific server-side collection. If no item with *id* exists in the collection, the
 * value of the proxy object is undefined. 
 * 
 * ProxyObject manages a set of items (an array) stored within a single item's state.
 * 
 * set_items() sets the entire array of items.
 * get_items() returns all items in the array.
 * get_item(id) returns a single item from the array.
 * has_item(id) returns true if an item with id exists in the array.
 * 
 */

export class ProxyObject {

    constructor(proxyCollection, id, options={}) {
        this._terminated = false;
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
            this._handlers.splice(index, 1);
        }
    };
    
    notify_callbacks (eArg) {
        this._handlers.forEach(function(handle) {
            handle.handler(eArg);
        });
    };

    set_items (items) {
        if (this._terminated) {
            throw new Error("proxy object terminated")
        }
        if (!Array.isArray(items)) {
            throw new Error("items must be an array")
        }
        const insertItems = [{id:this._id, state:items}];
        return this._coll.update_items({insert:insertItems, reset:false});
    }

    get_items () {
        if (this._coll.has_item(this._id)) {
            const item = this._coll.get_item(this._id);
            return (item && item.state) ? item.state : [];
        } else {
            return [];
        }
    }

    get_item (id) {
        const items = this.get_items();
        return items.find(item => item.id === id);
    }

    has_item (id) {
        return this.get_item(id) !== undefined;
    }
    
    ss_client_terminate() {
        this._terminated = true;
        this._coll.remove_callback(this._handle);
    }
}