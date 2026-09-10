/**
 * Message types used in client-server communication.
 */
export const MsgType = {
    REQUEST: "REQUEST",
    REPLY: "REPLY",
    MESSAGE: "MESSAGE"
};

/**
 * Message command verbs used in requests and notifications.
 */
export const MsgCmd = {
    GET: "GET",
    PUT: "PUT",
    NOTIFY: "NOTIFY"
};



/**
 * Normalizes a path string to ensure a leading slash.
 * @param {string} rawPath
 * @returns {string} Normalized path
 */
export function normalizePath(rawPath) {
    if (!rawPath || typeof rawPath !== "string") return "";
    return rawPath.startsWith("/") ? rawPath : "/" + rawPath;
}

/**
 * Validates that a path string is a valid 3-segment resource path (/app/store/resource).
 * @param {string} rawPath
 * @returns {string} Clean normalized 3-segment path
 */
export function validatePath(rawPath) {
    if (!rawPath || typeof rawPath !== "string") {
        throw new Error("Path must be a valid non-empty string.");
    }
    const normPath = normalizePath(rawPath);
    const segments = normPath.split("/").filter(Boolean);
    if (segments.length !== 3) {
        throw new Error(`Invalid path '${rawPath}'. Path must have exactly 3 segments (e.g. /app/store/res).`);
    }
    return normPath;
}

/**
 * Ensures an item object adheres to canonical structure with a valid id string.
 * @param {*} rawItem
 * @returns {Object}
 */
export function sanitizeItem(rawItem) {
    if (!rawItem || typeof rawItem !== "object") {
        return { id: "", state: null };
    }
    const id = String(rawItem.id ?? "");
    return {
        ...rawItem,
        id
    };
}

/**
 * Sanitizes any changes payload (arrays, Sets, Maps, or objects) into canonical runtime format:
 * { insert: Map(id -> item), remove: Set(id), reset: boolean, version?: number }
 * @param {Object} rawChanges
 * @returns {Changes}
 */
export function sanitizeChanges(rawChanges) {
    if (!rawChanges || typeof rawChanges !== "object") {
        return { insert: new Map(), remove: new Set(), reset: false };
    }

    const reset = Boolean(rawChanges.reset);
    const remove = new Set();
    const insert = new Map();

    // Process remove
    if (rawChanges.remove instanceof Set) {
        for (const id of rawChanges.remove) {
            remove.add(String(id));
        }
    } else if (Array.isArray(rawChanges.remove)) {
        for (const id of rawChanges.remove) {
            remove.add(String(id));
        }
    }

    // Process insert
    if (rawChanges.insert instanceof Map) {
        for (const [key, item] of rawChanges.insert.entries()) {
            const sanitized = sanitizeItem(item);
            const id = sanitized.id || String(key || "");
            insert.set(id, { ...sanitized, id });
        }
    } else if (Array.isArray(rawChanges.insert)) {
        let idx = 0;
        for (const item of rawChanges.insert) {
            const sanitized = sanitizeItem(item);
            const id = sanitized.id || "";
            const key = id || `__pending_${idx++}`;
            insert.set(key, { ...sanitized, id });
        }
    }

    const result = { insert, remove, reset };
    if (rawChanges.version !== undefined) {
        result.version = rawChanges.version;
    }
    if (rawChanges.last_version !== undefined) {
        result.last_version = rawChanges.last_version;
    }
    return result;
}

/**
 * Serializes runtime Map/Set changes back to wire JSON format for WebSocket transmission:
 * { insert: Array, remove: Array, reset: boolean, version?: number }
 * @param {Object} changes
 * @returns {Object}
 */
export function serializeChanges(changes) {
    if (!changes || typeof changes !== "object") return changes;

    const reset = Boolean(changes.reset);
    const remove = changes.remove instanceof Set
        ? Array.from(changes.remove)
        : (Array.isArray(changes.remove) ? changes.remove : []);

    const insert = changes.insert instanceof Map
        ? Array.from(changes.insert.values())
        : (Array.isArray(changes.insert) ? changes.insert : []);

    const result = { insert, remove, reset };
    if (changes.version !== undefined) {
        result.version = changes.version;
    }
    if (changes.last_version !== undefined) {
        result.last_version = changes.last_version;
    }
    return result;
}
