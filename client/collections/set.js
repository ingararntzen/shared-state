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
    constructor(proxyCollection, options = {}) {
        super(proxyCollection);
        this._options = options;
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

    add(elem) {
        const id = this._getId(elem);
        this._elemCache.set(id, elem);
        const record = { id, state: elem };
        return this._proxyCollection.update_items({ insert: [record] });
    }

    delete(elem) {
        const id = this._getId(elem);
        return this._proxyCollection.update_items({ remove: [id] });
    }

    has(elem) {
        const id = this._getId(elem);
        return this._proxyCollection.has_item(id);
    }

    values() {
        return this._proxyCollection.get_items().map(item =>
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
        const { insert = [], remove = [], reset = false, version } = changes;
        const formattedInsert = [];
        const formattedRemove = [];

        if (reset) {
            this._elemCache.clear();
        }

        insert.forEach((item) => {
            const id = typeof item === "object" && item !== null && item.id !== undefined ? item.id : String(item);
            const val = (typeof item === "object" && item !== null)
                ? (item.state !== undefined ? item.state : (item.value !== undefined ? item.value : item))
                : item;
            this._elemCache.set(id, val);
            formattedInsert.push(val);
        });

        remove.forEach((id) => {
            if (this._elemCache.has(id)) {
                formattedRemove.push(this._elemCache.get(id));
                this._elemCache.delete(id);
            } else {
                formattedRemove.push(id);
            }
        });

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
