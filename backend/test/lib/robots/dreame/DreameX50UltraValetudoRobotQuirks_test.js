const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_quirks_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameQuirkFactory = require("../../../../lib/robots/dreame/DreameQuirkFactory");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

describe("DreameX50UltraValetudoRobot quirks", () => {
    /** @type {DreameX50UltraValetudoRobot} */
    let robot;
    /** @type {Array<{method: string, args: any}>} */
    let sentCommands;
    /** @type {any} */
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

            if (method === "get_properties") {
                return args.map(p => {
                    return Object.assign({}, p, {code: 0, value: readValue});
                });
            }

            return args.map(p => {
                return Object.assign({}, p, {code: 0});
            });
        };
    });

    after(async () => {
        await robot.shutdown();
        await new Promise(resolve => {
            robot.fdsMockServer.close(resolve);
        });
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

    describe("resume after charging", () => {
        it("reads siid 4 piid 11 and maps 1/0 to on/off", async () => {
            const q = quirk(DreameQuirkFactory.KNOWN_QUIRKS.RESUME_AFTER_CHARGING);

            sentCommands = [];
            readValue = 1;
            assert.strictEqual(await q.getter(), "on");
            assert.deepStrictEqual(
                [sentCommands[0].method, sentCommands[0].args[0].siid, sentCommands[0].args[0].piid],
                ["get_properties", 4, 11]
            );

            readValue = 0;
            assert.strictEqual(await q.getter(), "off");
        });

        it("rejects a value it does not know", async () => {
            readValue = 5;
            await assert.rejects(quirk(DreameQuirkFactory.KNOWN_QUIRKS.RESUME_AFTER_CHARGING).getter(), /invalid value 5/);
        });

        it("writes 1 for on and 0 for off", async () => {
            const q = quirk(DreameQuirkFactory.KNOWN_QUIRKS.RESUME_AFTER_CHARGING);

            sentCommands = [];
            await q.setter("on");
            await q.setter("off");

            assert.deepStrictEqual(
                sentCommands.map(c => {
                    return [c.method, c.args[0].siid, c.args[0].piid, c.args[0].value];
                }),
                [["set_properties", 4, 11, 1], ["set_properties", 4, 11, 0]]
            );
            await assert.rejects(q.setter("maybe"), /invalid value maybe/);
        });
    });

    describe("stain detection", () => {
        it("reads StainIdentify from the tunables of siid 4 piid 50, with 2 as off", async () => {
            const q = quirk(DreameQuirkFactory.KNOWN_QUIRKS.STAIN_DETECTION);

            sentCommands = [];
            readValue = JSON.stringify([{k: "SmartHost", v: 0}, {k: "StainIdentify", v: 1}]);
            assert.strictEqual(await q.getter(), "on");
            assert.deepStrictEqual(
                [sentCommands[0].args[0].siid, sentCommands[0].args[0].piid],
                [4, 50]
            );

            readValue = JSON.stringify([{k: "StainIdentify", v: 2}]);
            assert.strictEqual(await q.getter(), "off");

            readValue = JSON.stringify([{k: "StainIdentify", v: 0}]);
            await assert.rejects(q.getter(), /invalid value 0/);
        });

        it("writes a single tunable with 1 for on and 2 for off", async () => {
            const q = quirk(DreameQuirkFactory.KNOWN_QUIRKS.STAIN_DETECTION);

            sentCommands = [];
            await q.setter("on");
            await q.setter("off");

            assert.deepStrictEqual(
                sentCommands.map(c => {
                    return [c.args[0].siid, c.args[0].piid, JSON.parse(c.args[0].value)];
                }),
                [[4, 50, {k: "StainIdentify", v: 1}], [4, 50, {k: "StainIdentify", v: 2}]]
            );
        });
    });
});
