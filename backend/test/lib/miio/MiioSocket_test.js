const assert = require("node:assert");
const { describe, it } = require("node:test");
const { EventEmitter } = require("node:events");

const Codec = require("../../../lib/miio/Codec");
const MiioErrorResponseRobotFirmwareError = require("../../../lib/miio/MiioErrorResponseRobotFirmwareError");
const MiioSocket = require("../../../lib/miio/MiioSocket");

describe("MiioSocket", () => {
    it("ignores responses with an id that is an Object.prototype property name", () => {
        const token = Buffer.alloc(16, 1);
        const remoteCodec = new Codec({token: token});
        const socket = Object.assign(new EventEmitter(), {send: () => {}});
        const incoming = [];

        // eslint-disable-next-line no-new
        new MiioSocket({
            socket: /** @type {any} */ (socket),
            token: token,
            deviceId: 1,
            name: "test",
            onIncomingRequestMessage: msg => {
                incoming.push(msg);
            }
        });

        for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            for (const msg of [{id: id, result: 1}, {id: id, error: {code: -1, message: "fail"}}]) {
                socket.emit("message", remoteCodec.encodeOutgoingMiioPacket(msg, 1), {address: "127.0.0.1", port: 54321});
            }
        }
        socket.emit(
            "message",
            remoteCodec.encodeOutgoingMiioPacket({id: 78, method: "properties_changed", params: []}, 1),
            {address: "127.0.0.1", port: 54321}
        );

        assert.deepStrictEqual(incoming, [{id: 78, method: "properties_changed", params: []}]);
    });

    it("rejects requests when the error response carries no error object", async () => {
        const token = Buffer.alloc(16, 1);
        const remoteCodec = new Codec({token: token});
        const socket = Object.assign(new EventEmitter(), {send: () => {}});
        const miioSocket = new MiioSocket({
            socket: /** @type {any} */ (socket),
            token: token,
            deviceId: 1,
            rinfo: {address: "127.0.0.1", port: 54321},
            timeout: 200,
            name: "test",
            isCloudSocket: true
        });

        const request = miioSocket.sendMessage({method: "action", params: {}});
        socket.emit("message", remoteCodec.encodeOutgoingMiioPacket({id: 1, error: null}, 1), {address: "127.0.0.1", port: 54321});

        await assert.rejects(request, MiioErrorResponseRobotFirmwareError);
    });


    it("generates MessageIds correctly", () => {
        // Jan 1970 means no synced time => 1 msgId per second
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1970-01-01T00:00:01.000Z")), 1);

        // Up until 1970-01-02, IDs are collision-free to allow the ntp sync to take some time
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1970-01-01T23:59:59.000Z")), 86399);
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1970-01-02T00:00:00.000Z")), 86400);

        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1970-01-31T23:59:59.000Z")), 2678399);
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1970-02-01T00:00:00.000Z")), 2678400);

        // >= Feb 1970 means synced time => 1 msgId every 10ms
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1970-02-01T00:00:01.000Z")), 267926500);

        // wrapping occurs every ~5965 hours
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1972-09-21T03:58:09.870Z")), 2147483646);
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1972-09-21T03:58:09.880Z")), 86400);

        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1973-05-27T16:57:42.340Z")), 2147483646);
        assert.strictEqual(MiioSocket.calculateMsgId(new Date("1973-05-27T16:57:42.350Z")), 86400);
    });
});
