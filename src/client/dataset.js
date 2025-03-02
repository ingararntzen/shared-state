

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
     * server refreshing dataset 
     */
    refresh(items) {
        // get old state
        // calculate diff
        // apply diff

        this.notify_callbacks()
    }

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
        const index = this._handlers.indexof(handle);
        if (index > -1) {
            this._handlers.splice(index, 1);
        }
    };
    
    notify_callbacks (eArg) {
        this._handlers.forEach(function(handle) {
            handle.handler(eArg);
        });
    };
}