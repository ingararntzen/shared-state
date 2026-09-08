import { BaseVariable } from "../base_objects/base_variable.js";
import { BaseTypedVariable, VariableType } from "../base_objects/base_typed_variable.js";

/**
 * Generic untyped shared variable holding any serializable value.
 * Extends {@link BaseVariable}.
 * @class SharedVariable
 */
export class SharedVariable extends BaseVariable { }

/**
 * Shared boolean variable.
 * Extends {@link BaseVariable}.
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
     * @returns {Promise<void>} Resolves when state update is processed
     */
    toggle() {
        const current = this.value;
        return this.set(!current);
    }
}

/**
 * Shared string variable.
 * Extends {@link BaseVariable}.
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
 * Shared integer variable supporting increment and decrement operations.
 * Extends {@link BaseVariable}.
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
     * @returns {Promise<void>} Resolves when state update is processed
     */
    inc(delta = 1) {
        const current = this.value;
        return this.set((current || 0) + delta);
    }

    /**
     * Decrements the integer value by delta.
     * @param {number} [delta=1] - Amount to decrement
     * @returns {Promise<void>} Resolves when state update is processed
     */
    dec(delta = 1) {
        const current = this.value;
        return this.set((current || 0) - delta);
    }
}

/**
 * Shared floating-point number variable supporting numeric adjustments.
 * Extends {@link BaseVariable}.
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
     * @returns {Promise<void>} Resolves when state update is processed
     */
    inc(delta = 1.0) {
        const current = this.value;
        return this.set((current || 0) + delta);
    }

    /**
     * Decrements the float value by delta.
     * @param {number} [delta=1.0] - Amount to decrement
     * @returns {Promise<void>} Resolves when state update is processed
     */
    dec(delta = 1.0) {
        const current = this.value;
        return this.set((current || 0) - delta);
    }
}

/**
 * Shared JSON object variable.
 * Extends {@link BaseVariable}.
 * @class SharedObject
 */
export class SharedObject extends BaseTypedVariable {
    /**
     * Initializes a SharedObject.
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
 * Shared array variable.
 * Extends {@link BaseVariable}.
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


