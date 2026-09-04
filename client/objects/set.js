import { BaseCollection } from "../base_objects/base_collection.js";

export function canonicalStringify(val) {
    if (val === null || typeof val !== "object") {
        return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
        return "[" + val.map(canonicalStringify).join(",") + "]";
    }
    const keys = Object.keys(val).sort();
    const keyValPairs = keys.map(k => `${JSON.stringify(k)}:${canonicalStringify(val[k])}`);
    return "{" + keyValPairs.join(",") + "}";
}

export class SharedSet extends BaseCollection {
    constructor(client, path, options = {}) {
        super(client, path, options);
        this._keyFn = options.key || options.get_id || null;
    }

    _getId(elem) {
        if (this._keyFn) {
            return String(this._keyFn(elem));
        }
        if (elem !== null && typeof elem === "object" && elem.id !== undefined) {
            return String(elem.id);
        }
        return canonicalStringify(elem);
    }

    async add(elem) {
        const id = this._getId(elem);
        const record = { id, state: elem };
        return await this._provider.update_items({ insert: [record] });
    }

    async delete(elem) {
        const id = this._getId(elem);
        return await this._provider.update_items({ remove: [id] });
    }

    async clear() {
        return await this._provider.update_items({ reset: true });
    }

    has(elem) {
        const id = this._getId(elem);
        return this._provider.has_item(id);
    }

    keys() {
        return this.values();
    }

    values() {
        return this._provider.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        );
    }

    entries() {
        return this.values().map(val => [val, val]);
    }

    forEach(callback, thisArg) {
        for (const val of this.values()) {
            callback.call(thisArg, val, val, this);
        }
    }

    [Symbol.iterator]() {
        return this.values()[Symbol.iterator]();
    }
}
