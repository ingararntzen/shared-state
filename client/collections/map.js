import { BaseCollection } from "./base_collection.js";

export class SharedMap extends BaseCollection {
    set(key, value) {
        const record = { id: key, state: value };
        return this._proxyCollection.update_items({ insert: [record] });
    }

    delete(key) {
        return this._proxyCollection.update_items({ remove: [key] });
    }

    get(key) {
        const item = this._proxyCollection.get_item(key);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    has(key) {
        return this._proxyCollection.has_item(key);
    }
}
