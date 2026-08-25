import { random_string } from "./util/util.js";

export class ProxyCollection {

    constructor(ssclient, path, options={}) {
        this._options = options;
        this._terminated = false;
        // sharedstate client
        this._ssclient = ssclient;
        this._path = path;
        // callbacks
        this._handlers = [];
        // items
        this._map = new Map();
    }

    /*********************************************************
        SHARED STATE CLIENT API
    **********************************************************/

    /**
     * Collection released by ss client
     */

    _ssclient_terminate() {
        this._terminated = true;
        // empty collection?
        // disconnect from observers
        this._handlers = [];
    }

    /**
     * server update collection 
     */
    _ssclient_update (changes={}) {

        if (this._terminated) {
            throw new Error("collection already terminated")
        }

        const {remove=[], insert=[], reset=false} = changes;
        const eff_remove = [];
        const eff_insert = [];

        if (reset) {
            eff_remove.push(...this._map.keys());
            this._map = new Map();
        } else {
            for (const _id of remove) {
                if (this._map.has(_id)) {
                    this._map.delete(_id);
                    eff_remove.push(_id);
                }
            }
        }

        for (const item of insert) {
            this._map.set(item.id, item);
            eff_insert.push(item);
        }

        const effective_changes = {
            remove: eff_remove,
            insert: eff_insert,
            reset: reset
        };

        this._notify_callbacks(effective_changes);
    }

    _notify_callbacks (eArg) {
        this._handlers.forEach(function(handle) {
            handle.handler(eArg);
        });
    };

    /*********************************************************
        APPLICATION API
    **********************************************************/

    get size() {return this._map.size}
    has_item(id) {return this._map.has(id)}
    get_item(id) {return this._map.get(id)}
    get_items() {return [...this._map.values()]}

    /**
     * application dispatching update to server
     */
    update_items (changes={}) {
        if (this._terminated) {
            throw new Error("collection already terminated")
        }
        // ensure that inserted items have ids
        const {insert=[]} = changes;
        changes.insert = insert.map((item) => {
            item.id = item.id || random_string(10);
            return item;
        });
        return this._ssclient.update(this._path, changes);
    }

    /**
     * application register callback
    */
    add_callback (handler) {
        const handle = {handler};
        this._handlers.push(handle);
        return handle;
    };    
    remove_callback (handle) {
        const index = this._handlers.indexOf(handle);
        if (index > -1) {
            this._handlers.splice(index, 1);
        }
    };    
}