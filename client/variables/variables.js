import { SharedVariable } from "./shared_variable.js";
import { SharedTypedVariable, VarType } from "./shared_typed_variable.js";

export { SharedVariable, SharedTypedVariable, VarType };

export class SharedBool extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VarType.BOOL, options);
    }

    set(val) {
        return super.set(Boolean(val));
    }
}

export class SharedString extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VarType.STRING, options);
    }

    set(val) {
        return super.set(String(val));
    }
}

export class SharedInteger extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VarType.INTEGER, options);
    }

    set(val) {
        return super.set(Math.round(Number(val) || 0));
    }

    inc(delta = 1) {
        const current = this.value;
        return this.set((current || 0) + delta);
    }

    dec(delta = 1) {
        const current = this.value;
        return this.set((current || 0) - delta);
    }
}

export class SharedFloat extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VarType.FLOAT, options);
    }

    set(val) {
        return super.set(Number(val) || 0.0);
    }

    inc(delta = 1.0) {
        const current = this.value;
        return this.set((current || 0) + delta);
    }

    dec(delta = 1.0) {
        const current = this.value;
        return this.set((current || 0) - delta);
    }
}

export class SharedObject extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VarType.OBJECT, options);
    }

    set(val) {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
            throw new TypeError("SharedObject value must be an object ({})");
        }
        return super.set(val);
    }
}

export class SharedArray extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VarType.ARRAY, options);
    }

    set(val) {
        if (!Array.isArray(val)) {
            throw new TypeError("SharedArray value must be an array ([])");
        }
        return super.set(val);
    }
}
