const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, beforeEach, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_install_state_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameQuirkFactory = require("../../../../lib/robots/dreame/DreameQuirkFactory");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

describe("DreameX50UltraValetudoRobot consumable install state quirks", () => {
    /** @type {DreameX50UltraValetudoRobot} */
    let robot;
    /** @type {Array<{method: string, args: any}>} */
    let sentCommands;
    let readValue;

    before(() => {
        robot = new DreameX50UltraValetudoRobot({
            config: new Configuration(),
            valetudoEventStore: new ValetudoEventStore()
        });

        // The getter reads the device.conf of the robot, which does not exist here
        Object.defineProperty(robot, "deviceId", {value: 123456789});

        robot.sendCommand = async (method, args) => {
            sentCommands.push({method: method, args: args});

            return args.map(p => {
                return Object.assign({}, p, method === "get_properties" ? {code: 0, value: readValue} : {code: 0});
            });
        };
    });

    after(async () => {
        await robot.shutdown();
        await new Promise(resolve => {
            robot.fdsMockServer.close(resolve);
        });
    });

    beforeEach(() => {
        sentCommands = [];
    });

    /**
     * @param {string} id
     * @returns {import("../../../../lib/core/Quirk")}
     */
    function quirk(id) {
        const found = robot.capabilities.QuirksCapability.quirks.find(q => {
            return q.id === id;
        });
        assert.ok(found, `quirk ${id} is registered`);

        return found;
    }

    for (const [name, id, siid] of [
        ["mop pad", DreameQuirkFactory.KNOWN_QUIRKS.MOP_PAD_TRACKING, 18],
        ["detergent", DreameQuirkFactory.KNOWN_QUIRKS.DETERGENT_TRACKING, 20],
        ["silver ion", DreameQuirkFactory.KNOWN_QUIRKS.SILVER_ION_TRACKING, 19],
        ["deodorant", DreameQuirkFactory.KNOWN_QUIRKS.DEODORANT_TRACKING, 29],
        ["scale inhibitor", DreameQuirkFactory.KNOWN_QUIRKS.SCALE_INHIBITOR_TRACKING, 31]
    ]) {
        describe(name, () => {
            it(`reads piid 3 of siid ${siid}, as seen live: 0 = off, 1 = on`, async () => {
                readValue = 0;
                assert.strictEqual(await quirk(id).getter(), "off");
                readValue = 1;
                assert.strictEqual(await quirk(id).getter(), "on");

                assert.deepStrictEqual(
                    sentCommands.map(c => {
                        return [c.method, c.args[0].siid, c.args[0].piid];
                    }),
                    [["get_properties", siid, 3], ["get_properties", siid, 3]]
                );
            });

            it("rejects an unknown value", async () => {
                readValue = 7;
                await assert.rejects(quirk(id).getter(), /invalid value 7/);
            });

            it(`writes 1 and 0 to siid ${siid} piid 3`, async () => {
                await quirk(id).setter("on");
                await quirk(id).setter("off");

                assert.deepStrictEqual(
                    sentCommands.map(c => {
                        return [c.method, c.args[0].siid, c.args[0].piid, c.args[0].value];
                    }),
                    [["set_properties", siid, 3, 1], ["set_properties", siid, 3, 0]]
                );
                await assert.rejects(quirk(id).setter("maybe"), /invalid value maybe/);
            });
        });
    }
});
