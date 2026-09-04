import { BaseCollection } from "../base_objects/base_collection.js";

export class SharedMap extends BaseCollection {
    async set(key, value) {
        const record = { id: key, state: value };
        return await this._provider.update_items({ insert: [record] });
    }

    async delete(key) {
        return await this._provider.update_items({ remove: [key] });
    }

    async clear() {
        return await this._provider.update_items({ reset: true });
    }

    get(key) {
        const item = this._provider.get_item(key);
        if (!item) return undefined;
        return item.state !== undefined ? item.state : item.value;
    }

    has(key) {
        return this._provider.has_item(key);
    }

    keys() {
        return this._provider.get_items().map(item => item.id);
    }

    values() {
        return this._provider.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        );
    }

    entries() {
        return this._provider.get_items().map(item => [
            item.id,
            item.state !== undefined ? item.state : item.value
        ]);
    }

    forEach(callback, thisArg) {
        for (const [key, val] of this.entries()) {
            callback.call(thisArg, val, key, this);
        }
    }

    [Symbol.iterator]() {
        return this.entries()[Symbol.iterator]();
    }
}
