import { BaseVariable } from "./base_variable.js";

export class Variable extends BaseVariable {
    get defaultValue() {
        return undefined;
    }

    _validate(val) {
        return val !== undefined && val !== null ? val : undefined;
    }

    get value() {
        const raw = this._get_current_raw();
        const validVal = this._validate(raw);
        if (validVal !== undefined) {
            this._hasValidValue = true;
            return validVal;
        }
        if (!this._hasValidValue && this._initialValue !== undefined) {
            return this._initialValue;
        }
        return this.defaultValue;
    }

    set(val) {
        return this._proxyCollection.update_items({
            insert: [{ id: this._itemId, state: val }]
        });
    }
}

export class SharedBool extends Variable {
    get defaultValue() {
        return false;
    }

    _validate(val) {
        if (typeof val === "boolean") return val;
        if (val === "true") return true;
        if (val === "false") return false;
        return undefined;
    }

    set(val) {
        return super.set(Boolean(val));
    }
}

export class SharedString extends Variable {
    get defaultValue() {
        return "";
    }

    _validate(val) {
        if (typeof val === "string") return val;
        return undefined;
    }

    set(val) {
        return super.set(String(val));
    }
}

export class SharedInteger extends Variable {
    get defaultValue() {
        return 0;
    }

    _validate(val) {
        if (typeof val === "number" && Number.isInteger(val)) return val;
        if (typeof val === "string" && val.trim() !== "") {
            const parsed = parseInt(val, 10);
            if (!isNaN(parsed)) return parsed;
        }
        return undefined;
    }

    set(val) {
        return super.set(Math.round(Number(val) || 0));
    }

    inc(delta = 1) {
        const current = this.value;
        return this.set(current + delta);
    }

    dec(delta = 1) {
        const current = this.value;
        return this.set(current - delta);
    }
}

export class SharedFloat extends Variable {
    get defaultValue() {
        return 0.0;
    }

    _validate(val) {
        if (typeof val === "number" && !isNaN(val)) return val;
        if (typeof val === "string" && val.trim() !== "") {
            const parsed = parseFloat(val);
            if (!isNaN(parsed)) return parsed;
        }
        return undefined;
    }

    set(val) {
        return super.set(Number(val) || 0.0);
    }

    inc(delta = 1.0) {
        const current = this.value;
        return this.set(current + delta);
    }

    dec(delta = 1.0) {
        const current = this.value;
        return this.set(current - delta);
    }
}

export class SharedObject extends Variable {
    get defaultValue() {
        return {};
    }

    _validate(val) {
        if (typeof val === "object" && val !== null && !Array.isArray(val)) {
            return val;
        }
        return undefined;
    }

    set(val) {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
            throw new TypeError("SharedObject value must be an object ({})");
        }
        return super.set(val);
    }
}

export class SharedArray extends Variable {
    get defaultValue() {
        return [];
    }

    _validate(val) {
        if (Array.isArray(val)) {
            return val;
        }
        return undefined;
    }

    set(val) {
        if (!Array.isArray(val)) {
            throw new TypeError("SharedArray value must be an array ([])");
        }
        return super.set(val);
    }
}
