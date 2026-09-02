import { BaseCollection } from "./base_collection.js";

export class SharedMap extends BaseCollection {
    async set(key, value) {
        const record = { id: key, state: value };
        return await this._provider.update_items({ insert: [record] });
    }

    async delete(key) {
        return await this._provider.update_items({ remove: [key] });
    }

    get(key) {
        const item = this._provider.get_item(key);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    has(key) {
        return this._provider.has_item(key);
    }
}
