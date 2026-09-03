import { BaseCollection } from "./base_collection.js";

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
        this._elemCache = new Map(); // id -> set element
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
        this._elemCache.set(id, elem);
        const record = { id, state: elem };
        return await this._provider.update_items({ insert: [record] });
    }

    async delete(elem) {
        const id = this._getId(elem);
        return await this._provider.update_items({ remove: [id] });
    }

    has(elem) {
        const id = this._getId(elem);
        return this._provider.has_item(id);
    }

    values() {
        return this._provider.get_items().map(item =>
            item.state !== undefined ? item.state : item.value
        );
    }

    get_state(name) {
        if (name === "change") {
            const elements = this.values();
            return { remove: [], insert: elements, reset: true };
        }
        return null;
    }

    _formatChanges(changes = {}) {
        const { insert, remove, reset, version } = changes;
        const formattedInsert = [];
        const formattedRemove = [];

        if (reset) {
            this._elemCache.clear();
        }

        const insertItems = insert instanceof Map ? insert.values() : (Array.isArray(insert) ? insert : []);
        for (const item of insertItems) {
            const id = typeof item === "object" && item !== null && item.id !== undefined ? item.id : String(item);
            const val = (typeof item === "object" && item !== null)
                ? (item.state !== undefined ? item.state : (item.value !== undefined ? item.value : item))
                : item;
            this._elemCache.set(id, val);
            formattedInsert.push(val);
        }

        const removeIds = remove instanceof Set ? remove : (Array.isArray(remove) ? remove : []);
        for (const id of removeIds) {
            if (this._elemCache.has(id)) {
                formattedRemove.push(this._elemCache.get(id));
                this._elemCache.delete(id);
            } else {
                formattedRemove.push(id);
            }
        }

        return {
            insert: formattedInsert,
            remove: formattedRemove,
            reset: Boolean(reset),
            version
        };
    }

    [Symbol.iterator]() {
        return this.values()[Symbol.iterator]();
    }
}
