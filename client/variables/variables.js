import { BaseVariable } from "./base_variable.js";

export class Variable extends BaseVariable {
    get value() {
        return this._get_current_raw();
    }

    set(val) {
        return this._proxyCollection.update_items({
            insert: [{ id: this._itemId, state: val }]
        });
    }
}

export class SharedValue extends Variable {}


export class SharedString extends Variable {
    set(val) {
        return super.set(String(val));
    }
}

export class SharedInteger extends Variable {
    get value() {
        const v = super.value;
        return v !== undefined ? parseInt(v, 10) : 0;
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
    get value() {
        const v = super.value;
        return v !== undefined ? parseFloat(v) : 0.0;
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
    set(val) {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
            throw new TypeError("SharedObject value must be an object ({})");
        }
        return super.set(val);
    }
}

export class SharedArray extends Variable {
    set(val) {
        if (!Array.isArray(val)) {
            throw new TypeError("SharedArray value must be an array ([])");
        }
        return super.set(val);
    }
}
