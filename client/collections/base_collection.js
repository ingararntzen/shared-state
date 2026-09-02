import eventify from "../util/events.js";
import { validatePath } from "../common.js";

export class BaseCollection {
    constructor(client, path, options = {}) {
        if (!client || typeof client.collection !== "function") {
            throw new Error("Collection constructor expects a SharedStateClient instance as first argument.");
        }

        const normPath = validatePath(path);

        if (client._var_coll_paths && client._var_coll_paths.has(normPath)) {
            throw new Error(`Conflict: Cannot register Collection at '${path}'. Path is already reserved for Variables.`);
        }

        const cached = client._get_weak_object(normPath);
        if (cached) {
            return cached;
        }

        if (client._coll_paths) {
            client._coll_paths.add(normPath);
        }

        this._proxyCollection = client.collection(normPath, options);
        this._options = options;

        client._set_weak_object(normPath, this);

        this._proxyCollection.add_callback((changes) => {
            const formatted = this._formatChanges ? this._formatChanges(changes) : changes;
            this.emit("change", formatted);
        });
    }

    get path() {
        return this._proxyCollection.path;
    }

    get provider() {
        return this._proxyCollection;
    }

    get_state(name) {
        if (name === "change") {
            const items = this._proxyCollection.get_items();
            return { remove: [], insert: items, reset: true };
        }
        return null;
    }

    get size() {
        return this._proxyCollection.size;
    }

    get_items() {
        return this._proxyCollection.get_items();
    }
}

eventify(BaseCollection.prototype);
