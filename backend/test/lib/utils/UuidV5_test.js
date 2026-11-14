const assert = require("node:assert");
const { describe, it } = require("node:test");

const uuidV5 = require("../../../lib/utils/UuidV5");

describe("uuidV5", () => {
    it("matches the RFC 9562 appendix A.4 test vector", () => {
        assert.strictEqual(
            uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8"),
            "2ed6657d-e927-568b-95e1-2665a8aea6a2"
        );
    });

    it("keeps the system ID that uuid.v5() of the uuid package produced", () => {
        assert.strictEqual(
            uuidV5("aabbccddeeff", "be5f1ffc-c150-4785-9ebb-08fcfe90c933"),
            "3c912424-36f1-5b25-a51a-93b9b4bcd8ce"
        );
    });

    it("accepts an upper-case namespace", () => {
        assert.strictEqual(
            uuidV5("www.example.com", "6BA7B810-9DAD-11D1-80B4-00C04FD430C8"),
            "2ed6657d-e927-568b-95e1-2665a8aea6a2"
        );
    });

    it("throws on an invalid namespace", () => {
        assert.throws(() => {
            uuidV5("x", "not-a-uuid");
        }, TypeError);
    });
});
