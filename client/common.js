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
