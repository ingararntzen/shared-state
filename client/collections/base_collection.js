import eventify from "../util/events.js";

export class BaseCollection {
    constructor(proxyCollection) {
        this._proxyCollection = proxyCollection;

        this._proxyCollection.add_callback((changes) => {
            this.emit("change", changes);
        });
    }

    get_state(name) {
        if (name === "change") {
            const items = this._proxyCollection.get_items();
            return { remove: [], insert: items, reset: true };
        }
        return null;
    }

    get size() {
        return this._proxyCollection.size;
    }

    get_items() {
        return this._proxyCollection.get_items();
    }
}

eventify(BaseCollection.prototype);
