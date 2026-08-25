import { BaseCollection } from "./base_collection.js";
import { random_string } from "../util/util.js";

export class SharedList extends BaseCollection {
    append(item) {
        const id = (item && item.id) ? item.id : random_string(10);
        const record = typeof item === "object" && item !== null ? { ...item, id } : { id, state: item };
        return this._proxyCollection.update_items({ insert: [record] });
    }

    remove(id) {
        return this._proxyCollection.update_items({ remove: [id] });
    }

    get(id) {
        return this._proxyCollection.get_item(id);
    }
}
