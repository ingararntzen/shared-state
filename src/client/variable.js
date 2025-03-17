
/**
 * Variable
 * 
 * Wrapper to expose a single id (item) from a collection as a standalone variable
 * 
 * - if there is no item with id in collection - the variable will be undefined
 *   or have a default value
 * - otherwise, the variable will be the value of item.data
 * 
 *  Default value is given in options {value:}
 */

export class Variable {

    constructor(coll, id, options={}) {
        this._terminiated = false;
        this._coll = coll;
        this._id = id;
        this._options = options;
        // callback
        this._handlers = [];
        this._handle = this._coll.add_callback(this._onchange.bind(this));
    }

    _onchange(diffs) {
        if (this._terminated) {
            throw new Error("variable terminated")
        }
        for (const diff of diffs) {
            if (diff.id == this._id) {
                this._item = diff.new;
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
    
    set value (value) {
        if (this._terminated) {
            throw new Error("varible terminated")
        }
        const items = [{id:this._id, data:value}];
        return this._coll.update({insert:items, reset:false});
    }

    get value() {
        if (this._coll.has(this._id)) {
            return this._coll.get(this._id).data;
        } else {
            return this._options.value;
        }
    }
    
    ss_client_terminate() {
        this._terminated = true;
        this._coll.remove_callback(this._handle);
    }
}