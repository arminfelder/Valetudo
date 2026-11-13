const assert = require("node:assert");
const { describe, it } = require("node:test");

const DmiotCodec = require("../../../lib/dmiot/DmiotCodec");

describe("DmiotCodec", () => {
    it("encodes outgoing messages as plain JSON", () => {
        const encoded = DmiotCodec.encode({id: 1, method: "get_properties", params: [{siid: 3, piid: 1}]});

        assert.strictEqual(encoded.toString(), "{\"id\":1,\"method\":\"get_properties\",\"params\":[{\"siid\":3,\"piid\":1}]}");
    });

    it("rejects outgoing messages that do not fit into the robot receive buffer", () => {
        assert.throws(() => {
            DmiotCodec.encode({id: 1, method: "x", params: "a".repeat(5000)});
        });
    });

    it("decodes a single frame", () => {
        const codec = new DmiotCodec();
        const frame = Buffer.concat([
            Buffer.from([0xC0, 0x0e, 0x00]),
            Buffer.from("{\"id\":1,\"a\":1}"),
            Buffer.from([0x00])
        ]);

        assert.deepStrictEqual(codec.decode(frame), [{id: 1, a: 1}]);
    });

    it("decodes concatenated frames and frames split across chunks", () => {
        const codec = new DmiotCodec();
        const first = DmiotCodec.encodeFrame({id: 1, result: ["ok"]});
        const second = DmiotCodec.encodeFrame({id: 2, method: "properties_changed", params: []});
        const stream = Buffer.concat([first, second]);

        assert.deepStrictEqual(codec.decode(stream.subarray(0, 2)), []);
        assert.deepStrictEqual(codec.decode(stream.subarray(2, first.length + 5)), [{id: 1, result: ["ok"]}]);
        assert.deepStrictEqual(codec.decode(stream.subarray(first.length + 5)), [{id: 2, method: "properties_changed", params: []}]);
    });

    it("resynchronizes on the frame marker after garbage", () => {
        const codec = new DmiotCodec();
        const stream = Buffer.concat([
            Buffer.from("garbage"),
            DmiotCodec.encodeFrame({id: 3, result: "ok"})
        ]);

        assert.deepStrictEqual(codec.decode(stream), [{id: 3, result: "ok"}]);
    });

    it("drops frames with a JSON payload that is not an object", () => {
        const codec = new DmiotCodec();
        const stream = Buffer.concat([
            DmiotCodec.encodeFrame(null),
            DmiotCodec.encodeFrame(42),
            DmiotCodec.encodeFrame("text"),
            DmiotCodec.encodeFrame([{id: 1}]),
            DmiotCodec.encodeFrame({id: 4, result: "ok"})
        ]);

        assert.deepStrictEqual(codec.decode(stream), [{id: 4, result: "ok"}]);
    });
});
