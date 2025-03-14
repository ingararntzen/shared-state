
/**
 * Variable
 * 
 * Wrapper to expose a single id (item) from an dataset as a standalone variable
 * 
 * - if there is no item with id in dataset - the variable will be undefined
 *   or have a default value
 * - otherwise, the item will be the value of the variable
 * 
 *  Variable implements the same interface as a dataset
 *  
 *  Default value is given in options {value:}
 */

export class Variable {

    constructor(ds, id, options={}) {
        this._terminiated = false;
        this._ds = ds;
        this._id = id;
        this._options = options;
        // callback
        this._handlers = [];
        this._handle = this._ds.add_callback(this._onchange.bind(this));
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
        return this._ds.update({insert:items, reset:false});
    }

    get value() {
        if (this._ds.has_item(this._id)) {
            return this._ds.get_item(this._id).data;
        } else {
            return this._options.value;
        }
    }
    
    ss_client_terminate() {
        this._terminated = true;
        this._ds.remove_callback(this._handle);
    }
}