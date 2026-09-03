import { BaseVariable } from "../base_objects/base_variable.js";
import { BaseTypedVariable, VariableType } from "../base_objects/base_typed_variable.js";

/**
 * Untyped shared variable.
 */
export class SharedVariable extends BaseVariable {
    async set(val) {
        return await this.provider.update_items({
            insert: [{ id: this.name, state: val }]
        });
    }
}

// Re-export base typed variable & type enum
export { BaseTypedVariable, BaseTypedVariable as SharedTypedVariable, VariableType, VariableType as VarType };

export class SharedBoolean extends BaseTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.BOOL, options);
    }
}
export { SharedBoolean as SharedBool };

export class SharedString extends BaseTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.STRING, options);
    }
}

export class SharedInteger extends BaseTypedVariable {
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

export class SharedFloat extends BaseTypedVariable {
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

export class SharedObject extends BaseTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.OBJECT, options);
    }
}

export class SharedArray extends BaseTypedVariable {
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.ARRAY, options);
    }
}
