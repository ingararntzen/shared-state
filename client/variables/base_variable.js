import eventify from "../util/events.js";
import { validatePath } from "../common.js";

export class BaseVariable {
    constructor(client, path, name, options = {}) {
        if (!client || typeof client.provider !== "function") {
            throw new Error("Variable constructor expects a SharedStateClient instance as first argument.");
        }
        if (!name || typeof name !== "string") {
            throw new Error("Variable constructor expects a mandatory non-empty 'name' string as third argument.");
        }

        const normPath = validatePath(path);

        if (client._collections && client._get_collection ? client._get_collection(normPath) : client._collections.has(normPath)) {
            throw new Error(`Conflict: Cannot register Variable at '${path}'. Path is already reserved for Collection.`);
        }

        const cached = client._get_variable ? client._get_variable(normPath, name) : null;
        if (cached) {
            return cached;
        }

        this._provider = client.provider(normPath, options);
        this._itemId = name;
        this._name = name;
        this._path = normPath + "/" + name;
        this._options = options;
        this._initialValue = options.initialValue !== undefined ? options.initialValue : options.initial;
        this._hasValidValue = false;
        this._lastVal = undefined;

        if (client._set_variable) {
            client._set_variable(normPath, name, this);
        }

        this._provider.add_callback((changes) => {
            this._on_collection_update(changes);
        });
    }

    get path() {
        return this._path;
    }

    get name() {
        return this._name;
    }

    get provider() {
        return this._provider;
    }

    get() {
        return this.value;
    }

    _get_current_raw() {
        const item = this._provider.get_item(this._itemId);
        if (!item) return undefined;
        const val = item.state !== undefined ? item.state : item.value;
        if (typeof val === "object" && val !== null && val.value !== undefined) {
            return val.value;
        }
        return val;
    }

    get_state(name) {
        if (name === "change") {
            const val = this.value;
            return val !== undefined ? val : null;
        }
        return null;
    }

    _on_collection_update(changes) {
        const { remove = [], insert = [], reset = false } = changes;
        let touched = false;

        if (reset) {
            touched = true;
        } else {
            if (remove.includes(this._itemId)) {
                touched = true;
            }
            for (const item of insert) {
                if (item.id === this._itemId) {
                    touched = true;
                    break;
                }
            }
        }

        if (touched) {
            const newVal = this.value;
            if (newVal !== this._lastVal) {
                this._lastVal = newVal;
                this.emit("change", newVal);
            }
        }
    }
}

eventify(BaseVariable.prototype);
