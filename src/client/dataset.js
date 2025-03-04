

export class Dataset {

    constructor(dcclient, path) {
        // dcclient
        this._dcclient = dcclient;
        this._path = path;
        // callbacks
        this._handlers = [];
        // items
        this._map = new Map();
    }

    /*********************************************************
        DC CLIENT API
    **********************************************************/

    /**
     * server reset dataset 
     */
    _dcclient_reset(insert_items) {
        // prepare diffs with oldstate

        const diff_map = new Map([...this._map.values()]
            .map(item => {
                return {id: item.id, new:undefined, old:item}
            }));

        // reset state and build diff map
        this._map = new Map();
        for (const item of insert_items) {
            this._map.set(item.id, item);
            if (diff_map.has(item.id)) {
                diff_map.get(item.id).new = item;                
            } else {
                diff_map.set(item.id, {id:item.id, new: item, old:undefined});
            }
        }
        this._dcclient_notify_callbacks([...diff_map.values()]);
    }

    /**
     * server update dataset 
     */
    _dcclient_update (remove_ids, insert_items) {
        const diff_map = new Map();

        // remove
        for (const _id of remove_ids) {
            const old = this._msg.get(_id);
            if (old != undefined) {
                this._msg.delete(_id);
                diff_map.set(_id, {id:_id, new:undefined, old});
            }
        }

        // insert
        for (const item of insert_items) {
            const _id = item.id;
            // old from diff_map or _map
            const diff = this._diff_map.get(_id);
            const old = (diff != undefined) ? diff.old : this._map.get(_id);
            // set state
            this._map.set(_id, item);
            // update diff map
            diff_map.set(_id, {id:_id, new:item, old});
        }
        this._dcclient_notify_callbacks([...diff_map.values()]);
    }

    _dcclient_notify_callbacks (eArg) {
        this._handlers.forEach(function(handle) {
            handle.handler(eArg);
        });
    };



    /*********************************************************
        APPLICATION API
    **********************************************************/

    /**
     * application requesting items
     */
    get_items() {
        return [...this._map.values()];
    };

    /**
     * application dispatching update to server
     */
    update (changes) {
        //this._dcclient._put(this._path, )
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