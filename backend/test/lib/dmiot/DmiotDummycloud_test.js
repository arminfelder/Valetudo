const assert = require("node:assert");
const net = require("node:net");
const { once } = require("node:events");
const { describe, it } = require("node:test");

const DmiotCodec = require("../../../lib/dmiot/DmiotCodec");
const DmiotDummycloud = require("../../../lib/dmiot/DmiotDummycloud");

/**
 * @param {net.Socket} client
 * @param {number} count
 * @returns {Promise<Array<any>>}
 */
async function readMessages(client, count) {
    let data = "";

    while ((data.match(/}{/g)?.length ?? 0) + 1 < count || data === "") {
        data += (await once(client, "data"))[0].toString();
    }

    return data.split("}{").map((part, i, parts) => {
        return JSON.parse((i > 0 ? "{" : "") + part + (i < parts.length - 1 ? "}" : ""));
    });
}

describe("DmiotDummycloud", () => {
    it("announces the cloud connection and answers time queries with local.time", async () => {
        const forwarded = [];
        let connected = false;

        const dummycloud = new DmiotDummycloud({
            bindIP: "127.0.0.1",
            port: 0,
            onConnected: () => {
                connected = true;
            },
            onIncomingCloudMessage: msg => {
                forwarded.push(msg);

                return true;
            }
        });
        await once(dummycloud.miioSocket.server, "listening");

        const client = net.connect(/** @type {net.AddressInfo} */ (dummycloud.miioSocket.server.address()).port, "127.0.0.1");
        await once(client, "connect");

        const [status] = await readMessages(client, 1);
        assert.strictEqual(status.method, "local.status");
        assert.strictEqual(status.params, "cloud_connected");
        assert.strictEqual(connected, true);

        client.write(DmiotCodec.encodeFrame({id: 4148, method: "local.query_time"}));
        const [time] = await readMessages(client, 1);

        assert.strictEqual(time.method, "local.time");
        assert.ok(Number.isInteger(time.params));
        assert.ok(Math.abs(time.params - Date.now() / 1000) < 5);

        client.write(DmiotCodec.encodeFrame({method: "_otc.info", params: {}}));
        client.write(DmiotCodec.encodeFrame({id: 5, method: "properties_changed", params: []}));
        await new Promise(resolve => {
            setTimeout(resolve, 50);
        });

        assert.deepStrictEqual(forwarded, [{id: 5, method: "properties_changed", params: []}]);

        client.destroy();
        await dummycloud.shutdown();
    });
});
