import { BaseCollection } from "./base_collection.js";
import { random_string } from "../util/util.js";

export class SharedSet extends BaseCollection {
    add(item) {
        const id = (item && item.id) ? item.id : (typeof item === "string" || typeof item === "number" ? String(item) : random_string(10));
        const record = typeof item === "object" && item !== null ? { ...item, id } : { id, state: item };
        return this._proxyCollection.update_items({ insert: [record] });
    }

    delete(id) {
        return this._proxyCollection.update_items({ remove: [id] });
    }

    has(id) {
        return this._proxyCollection.has_item(id);
    }
}
