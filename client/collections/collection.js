import { BaseCollection } from "./base_collection.js";

export class SharedCollection extends BaseCollection {
    update_items(changes = {}) {
        return this._proxyCollection.update_items(changes);
    }

    get_item(id) {
        return this._proxyCollection.get_item(id);
    }

    has_item(id) {
        return this._proxyCollection.has_item(id);
    }
}
