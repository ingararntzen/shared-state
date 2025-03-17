import { random_string } from "./util.js";

export class Collection {

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
     * Dataset released by ss client
     */

    _ssclient_terminate() {
        this._terminated = true;
        // empty dataset?
        // disconnect from observers
        this._handlers = [];
    }

    /**
     * server update dataset 
     */
    _ssclient_update (changes={}) {

        if (this._terminated) {
            throw new Error("dataset already terminated")
        }

        const {remove, insert, reset=false} = changes;
        const diff_map = new Map();

        // remove items - create diff
        if (reset) {
            for (const item of this._map.values()) {
                diff_map.set(
                    item.id, 
                    {id: item.id, new:undefined, old:item}
                );
            }
            this._map = new Map();
        } else {
            for (const _id of remove) {
                const old = this._map.get(_id);
                if (old != undefined) {
                    this._map.delete(_id);
                    diff_map.set(_id, {id:_id, new:undefined, old});
                }
            }
        }

        // insert items - update diff
        for (const item of insert) {
            const _id = item.id;
            // old from diff_map or _map
            const diff = diff_map.get(_id);
            const old = (diff != undefined) ? diff.old : this._map.get(_id);
            // set state
            this._map.set(_id, item);
            // update diff map
            diff_map.set(_id, {id:_id, new:item, old});
        }
        this._notify_callbacks([...diff_map.values()]);
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
    get(id) {return this._map.get(id)} 
    has(id) {return this._map.has(id)}
    keys() {return [...this._map.keys()]}
    items() {return [...this._map.values()]}

    /**
     * application dispatching update to server
     */
    update (changes={}) {
        if (this._terminated) {
            throw new Error("dataset already terminated")
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