import { SharedVariable } from "./shared_variable.js";
import { SharedTypedVariable, VariableType } from "./shared_typed_variable.js";

export { SharedVariable, SharedTypedVariable, VariableType };

export class SharedBool extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.BOOL, options);
    }
}

export class SharedString extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.STRING, options);
    }
}

export class SharedInteger extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.INTEGER, options);
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
        super(client, path, name, VariableType.FLOAT, options);
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
        super(client, path, name, VariableType.OBJECT, options);
    }
}

export class SharedArray extends SharedTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.ARRAY, options);
    }
}
