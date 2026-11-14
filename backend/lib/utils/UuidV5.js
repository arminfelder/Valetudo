const crypto = require("crypto");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Name-based UUID (version 5, SHA-1) as specified in RFC 9562 section 5.5.
 *
 * The output must stay identical to uuid.v5() of the "uuid" package.
 * The system ID and the obstacle IDs are derived with it.
 *
 * @param {string} name
 * @param {string} namespace UUID string, e.g. "6ba7b810-9dad-11d1-80b4-00c04fd430c8"
 * @returns {string}
 */
function uuidV5(name, namespace) {
    if (typeof namespace !== "string" || !UUID_REGEX.test(namespace)) {
        throw new TypeError("Namespace must be a valid UUID string");
    }

    const hash = crypto.createHash("sha1")
        .update(Buffer.from(namespace.replace(/-/g, ""), "hex"))
        .update(Buffer.from(name, "utf8"))
        .digest();

    hash[6] = (hash[6] & 0x0f) | 0x50;
    hash[8] = (hash[8] & 0x3f) | 0x80;

    const hex = hash.subarray(0, 16).toString("hex");

    return [
        hex.substring(0, 8),
        hex.substring(8, 12),
        hex.substring(12, 16),
        hex.substring(16, 20),
        hex.substring(20, 32)
    ].join("-");
}

module.exports = uuidV5;
