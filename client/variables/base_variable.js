import eventify from "../util/events.js";

export class BaseVariable {
    constructor(proxyCollection, itemId) {
        this._proxyCollection = proxyCollection;
        this._itemId = itemId;
        this._lastVal = undefined;

        this._proxyCollection.add_callback((changes) => {
            this._on_collection_update(changes);
        });
    }

    _get_current_raw() {
        const item = this._proxyCollection.get_item(this._itemId);
        if (!item) return undefined;
        const val = item.state !== undefined ? item.state : item.value;
        if (typeof val === "object" && val !== null && val.value !== undefined) {
            return val.value;
        }
        return val;
    }

    get_state(name) {
        if (name === "change") {
            const val = this._get_current_raw();
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
            const newVal = this._get_current_raw();
            this._lastVal = newVal;
            this.emit("change", newVal);
        }
    }
}

eventify(BaseVariable.prototype);
