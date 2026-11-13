const assert = require("node:assert");
const net = require("node:net");
const { describe, it } = require("node:test");
const { once } = require("node:events");

const DmiotCodec = require("../../../lib/dmiot/DmiotCodec");
const DmiotSocket = require("../../../lib/dmiot/DmiotSocket");
const MiioErrorResponseRobotFirmwareError = require("../../../lib/miio/MiioErrorResponseRobotFirmwareError");
const MiioTimeoutError = require("../../../lib/miio/MiioTimeoutError");

/**
 * @param {object} [handlers]
 * @returns {Promise<{dmiotSocket: DmiotSocket, client: net.Socket, incoming: Array<any>}>}
 */
async function setup(handlers = {}) {
    const incoming = [];
    let onConnected;
    const connected = new Promise(resolve => {
        onConnected = resolve;
    });

    const dmiotSocket = new DmiotSocket({
        bindIP: "127.0.0.1",
        port: 0,
        timeout: 200,
        onIncomingRequestMessage: msg => {
            incoming.push(msg);
        },
        onConnected: () => {
            onConnected();
            handlers.onConnected?.();
        }
    });
    await once(dmiotSocket.server, "listening");

    const client = net.connect(/** @type {net.AddressInfo} */ (dmiotSocket.server.address()).port, "127.0.0.1");
    await once(client, "connect");
    await connected;

    return {dmiotSocket: dmiotSocket, client: client, incoming: incoming};
}

describe("DmiotSocket", () => {
    it("resolves requests with the matching response from the robot", async () => {
        const {dmiotSocket, client} = await setup();

        client.on("data", data => {
            const request = JSON.parse(data.toString());

            assert.strictEqual(request.method, "get_properties");
            client.write(DmiotCodec.encodeFrame({id: request.id, result: [{siid: 3, piid: 1, code: 0, value: 100}]}));
        });

        const result = await dmiotSocket.sendMessage({method: "get_properties", params: [{siid: 3, piid: 1}]});

        assert.deepStrictEqual(result, [{siid: 3, piid: 1, code: 0, value: 100}]);
        assert.strictEqual(dmiotSocket.connected, true);

        client.destroy();
        await dmiotSocket.shutdown();
    });

    it("rejects requests with firmware errors", async () => {
        const {dmiotSocket, client} = await setup();

        client.on("data", data => {
            const request = JSON.parse(data.toString());

            client.write(DmiotCodec.encodeFrame({id: request.id, error: {code: -4001, message: "fail"}}));
        });

        await assert.rejects(
            dmiotSocket.sendMessage({method: "action", params: {}}),
            MiioErrorResponseRobotFirmwareError
        );

        client.destroy();
        await dmiotSocket.shutdown();
    });

    it("rejects requests without response after the timeout", async () => {
        const {dmiotSocket, client} = await setup();

        await assert.rejects(
            dmiotSocket.sendMessage({method: "action", params: {}}),
            MiioTimeoutError
        );

        client.destroy();
        await dmiotSocket.shutdown();
    });

    it("forwards requests from the robot and sends responses without waiting", async () => {
        const {dmiotSocket, client, incoming} = await setup();

        client.write(DmiotCodec.encodeFrame({id: 77, method: "_sync.gen_tmp_presigned_url", params: {suffix: "map"}}));
        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        assert.deepStrictEqual(incoming, [{id: 77, method: "_sync.gen_tmp_presigned_url", params: {suffix: "map"}}]);

        const response = once(client, "data");
        await dmiotSocket.sendMessage({id: 77, result: {ok: true}});

        assert.deepStrictEqual(JSON.parse((await response)[0].toString()), {id: 77, result: {ok: true}});

        client.destroy();
        await dmiotSocket.shutdown();
    });

    it("marks itself as disconnected when the robot closes the connection", async () => {
        const {dmiotSocket, client} = await setup();

        client.destroy();
        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        assert.strictEqual(dmiotSocket.connected, false);

        await dmiotSocket.shutdown();
    });

    it("ignores responses with an id that is an Object.prototype property name", async () => {
        const {dmiotSocket, client, incoming} = await setup();

        for (const id of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
            client.write(DmiotCodec.encodeFrame({id: id, result: 1}));
            client.write(DmiotCodec.encodeFrame({id: id, error: {code: -1, message: "fail"}}));
        }
        client.write(DmiotCodec.encodeFrame({id: 78, method: "properties_changed", params: []}));
        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        assert.deepStrictEqual(incoming, [{id: 78, method: "properties_changed", params: []}]);

        client.destroy();
        await dmiotSocket.shutdown();
    });

    it("rejects requests when the error response carries no error object", async () => {
        const {dmiotSocket, client} = await setup();

        client.on("data", data => {
            const request = JSON.parse(data.toString());

            client.write(DmiotCodec.encodeFrame({id: request.id, error: null}));
        });

        await assert.rejects(
            dmiotSocket.sendMessage({method: "action", params: {}}),
            MiioErrorResponseRobotFirmwareError
        );

        client.destroy();
        await dmiotSocket.shutdown();
    });

    it("keeps retrying to listen while the port is in use", async () => {
        const blocker = net.createServer();
        blocker.listen(0, "127.0.0.1");
        await once(blocker, "listening");
        const port = /** @type {net.AddressInfo} */ (blocker.address()).port;

        const dmiotSocket = new DmiotSocket({
            bindIP: "127.0.0.1",
            port: port,
            onIncomingRequestMessage: () => {},
            onConnected: () => {}
        });
        await once(dmiotSocket.server, "error");
        assert.strictEqual(dmiotSocket.server.listening, false);

        await new Promise(resolve => {
            blocker.close(resolve);
        });
        await once(dmiotSocket.server, "listening");

        assert.strictEqual(dmiotSocket.server.listening, true);

        await dmiotSocket.shutdown();
    });
});
