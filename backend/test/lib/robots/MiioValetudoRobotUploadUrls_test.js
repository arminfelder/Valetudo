const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_upload_urls_test_${process.pid}.json`);

const Configuration = require("../../../lib/Configuration");
const DmiotCodec = require("../../../lib/dmiot/DmiotCodec");
const DreameX50UltraValetudoRobot = require("../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const ValetudoEventStore = require("../../../lib/ValetudoEventStore");

/**
 * Field checks of FdsTmpUrlProcess / FdsUrlProcess in node_msg_cvt.so (fw 4.3.9_2199).
 * A wrong type makes ava drop the whole reply.
 *
 * @param {any} entry
 */
function assertAvaUrlEntry(entry) {
    assert.strictEqual(typeof entry.url, "string");
    assert.strictEqual(typeof entry.obj_name, "string");
    assert.strictEqual(entry.method, "PUT");
    assert.ok(Number.isInteger(entry.expires_time));
    assert.ok(entry.expires_time > Date.now() / 1000);
    assert.match(entry.url, /^http:\/\/127\.0\.0\.1:8079\/api\/miio\/fds_upload_handler\?/);
}

describe("MiioValetudoRobot upload url requests", () => {
    /** @type {DreameX50UltraValetudoRobot} */
    let robot;
    /** @type {Array<any>} */
    let sent;

    before(() => {
        robot = new DreameX50UltraValetudoRobot({
            config: new Configuration(),
            valetudoEventStore: new ValetudoEventStore()
        });

        sent = [];
        robot.sendCloud = async (msg) => {
            sent.push(msg);
        };
    });

    after(async () => {
        await robot.shutdown();
        await new Promise(resolve => {
            robot.fdsMockServer.close(resolve);
        });
    });

    for (const method of ["_sync.gen_tmp_presigned_url", "_sync.gen_tmp_url_v3"]) {
        it(`answers ${method} with one url entry per requested index`, () => {
            sent = [];
            const handled = robot.onIncomingCloudMessage({id: 31, method: method, params: {indexes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}});

            assert.strictEqual(handled, true);
            assert.strictEqual(sent.length, 1);
            assert.strictEqual(sent[0].id, 31);
            assert.strictEqual(sent[0].result.urls.length, 10);
            sent[0].result.urls.forEach((entry, i) => {
                assertAvaUrlEntry(entry);
                assert.ok(entry.url.includes(`&index=${i}&`));
            });

            // ava caches 10 slots. The reply must fit into one dmiot frame.
            assert.doesNotThrow(() => {
                DmiotCodec.encode(sent[0]);
            });
        });
    }

    for (const method of ["_sync.gen_presigned_url", "_sync.gen_presigned_url_v3"]) {
        it(`answers ${method} under the requested suffix`, () => {
            sent = [];
            const handled = robot.onIncomingCloudMessage({id: 32, method: method, params: {suffix: "1.FDS_MULT_MAP", use_https: true}});

            assert.strictEqual(handled, true);
            assert.strictEqual(sent[0].id, 32);

            const entry = sent[0].result["1.FDS_MULT_MAP"];
            assertAvaUrlEntry(entry);
            assert.strictEqual(entry.ok, true);
            assert.strictEqual(typeof entry.pwd, "string");
        });
    }

    it("returns the same reply shape for the legacy and the _v3 methods", () => {
        sent = [];
        robot.onIncomingCloudMessage({id: 1, method: "_sync.gen_tmp_presigned_url", params: {indexes: [0]}});
        robot.onIncomingCloudMessage({id: 2, method: "_sync.gen_tmp_url_v3", params: {indexes: [0]}});
        robot.onIncomingCloudMessage({id: 3, method: "_sync.gen_presigned_url", params: {suffix: "a"}});
        robot.onIncomingCloudMessage({id: 4, method: "_sync.gen_presigned_url_v3", params: {suffix: "a"}});

        assert.deepStrictEqual(Object.keys(sent[0].result.urls[0]).sort(), Object.keys(sent[1].result.urls[0]).sort());
        assert.deepStrictEqual(Object.keys(sent[2].result.a).sort(), Object.keys(sent[3].result.a).sort());
    });

    it("acknowledges _sync.update_vacuum_mapinfo so that ava stops resending it", () => {
        sent = [];
        const handled = robot.onIncomingCloudMessage({id: 33, method: "_sync.update_vacuum_mapinfo", params: {map_info: "x"}});

        assert.strictEqual(handled, true);
        assert.deepStrictEqual(sent, [{id: 33, result: "ok"}]);
    });

    it("leaves unrelated methods to the robot implementation", () => {
        sent = [];

        assert.strictEqual(robot.onIncomingCloudMessage({id: 34, method: "_sync.something_else", params: {}}), false);
        assert.deepStrictEqual(sent, []);
    });
});
