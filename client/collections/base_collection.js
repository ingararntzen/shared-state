import eventify from "../util/events.js";
import { validatePath } from "../common.js";

export class BaseCollection {
    constructor(client, path, options = {}) {
        if (!client || typeof client.provider !== "function") {
            throw new Error("Collection constructor expects a SharedStateClient instance as first argument.");
        }

        const normPath = validatePath(path);

        if (client._variables && client._variables.has(normPath)) {
            throw new Error(`Conflict: Cannot register Collection at '${path}'. Path is already reserved for Variables.`);
        }

        const cached = client._get_collection ? client._get_collection(normPath) : null;
        if (cached) {
            return cached;
        }

        this._provider = client.provider(normPath, options);
        this._options = options;

        if (client._set_collection) {
            client._set_collection(normPath, this);
        }

        this._provider.add_callback((changes) => {
            const formatted = this._formatChanges ? this._formatChanges(changes) : changes;
            this.emit("change", formatted);
        });
    }

    get path() {
        return this._provider.path;
    }

    get provider() {
        return this._provider;
    }

    get_state(name) {
        if (name === "change") {
            const items = this._provider.get_items();
            return { remove: [], insert: items, reset: true };
        }
        return null;
    }

    get size() {
        return this._provider.size;
    }

    get_items() {
        return this._provider.get_items();
    }
}

eventify(BaseCollection.prototype);
