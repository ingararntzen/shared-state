import { BaseVariable } from "../base_objects/base_variable.js";
import { BaseTypedVariable, VariableType } from "../base_objects/base_typed_variable.js";

/**
 * Generic *untyped* variable holding any serializable value.
 * @class SharedVariable
 */
export class SharedVariable extends BaseVariable { }

/**
 * Variable restricted to *boolean* values.
 * @class SharedBoolean
 */
export class SharedBoolean extends BaseTypedVariable {
    /**
     * Initializes a SharedBoolean.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Path prefix
     * @param {string} name - Variable key name
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.BOOL, options);
    }

    /**
     * Toggles the boolean value (`true` -> `false`, `false` -> `true`).
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    toggle() {
        const current = this.value;
        return this.set(!current);
    }
}

/**
 * Variable restricted to *string* values.
 * @class SharedString
 */
export class SharedString extends BaseTypedVariable {
    /**
     * Initializes a SharedString.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Path prefix
     * @param {string} name - Variable key name
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.STRING, options);
    }
}

/**
 * Variable restricted to *integer* values.
 * Supports increment and decrement operations.
 * @class SharedInteger
 */
export class SharedInteger extends BaseTypedVariable {
    /**
     * Initializes a SharedInteger.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Path prefix
     * @param {string} name - Variable key name
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.INTEGER, options);
    }

    /**
     * Increments the integer value by delta.
     * @param {number} [delta=1] - Amount to increment
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    inc(delta = 1) {
        const current = this.value;
        return this.set((current || 0) + delta);
    }

    /**
     * Decrements the integer value by delta.
     * @param {number} [delta=1] - Amount to decrement
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    dec(delta = 1) {
        const current = this.value;
        return this.set((current || 0) - delta);
    }
}

/**
 * Variable restricted to floating-point values.
 * Supports increment and decrement operations.
 * @class SharedFloat
 */
export class SharedFloat extends BaseTypedVariable {
    /**
     * Initializes a SharedFloat.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Path prefix
     * @param {string} name - Variable key name
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.FLOAT, options);
    }

    /**
     * Increments the float value by delta.
     * @param {number} [delta=1.0] - Amount to increment
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    inc(delta = 1.0) {
        const current = this.value;
        return this.set((current || 0) + delta);
    }

    /**
     * Decrements the float value by delta.
     * @param {number} [delta=1.0] - Amount to decrement
     * @returns {Promise<void>} Resolves when update request is acknowledged by the server
     */
    dec(delta = 1.0) {
        const current = this.value;
        return this.set((current || 0) - delta);
    }
}

/**
 * Variable restricted to *object* values.
 * @class SharedRecord
 */
export class SharedRecord extends BaseTypedVariable {
    /**
     * Initializes a SharedRecord.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Path prefix
     * @param {string} name - Variable key name
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.OBJECT, options);
    }
}

/**
 * Variable restricted to *array* values.
 * @class SharedArray
 */
export class SharedArray extends BaseTypedVariable {
    /**
     * Initializes a SharedArray.
     * @param {SharedStateClient} client - SharedState client instance
     * @param {string} path - Path prefix
     * @param {string} name - Variable key name
     * @param {Object} [options] - Configuration options
     */
    constructor(client, path, name, options = {}) {
        super(client, path, name, VariableType.ARRAY, options);
    }
}
