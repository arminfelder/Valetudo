const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_consumables_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const ValetudoConsumable = require("../../../../lib/entities/core/ValetudoConsumable");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

describe("DreameX50UltraValetudoRobot consumables", () => {
    /** @type {DreameX50UltraValetudoRobot} */
    let robot;
    /** @type {Array<{method: string, args: any}>} */
    let sentCommands;
    /** @type {(method: string, args: any) => any} */
    let respond;

    before(() => {
        robot = new DreameX50UltraValetudoRobot({
            config: new Configuration(),
            valetudoEventStore: new ValetudoEventStore()
        });

        // The getter reads the device.conf of the robot, which does not exist here
        Object.defineProperty(robot, "deviceId", {value: 123456789});

        sentCommands = [];
        robot.sendCommand = async (method, args) => {
            sentCommands.push({method: method, args: args});

            return respond(method, args);
        };
    });

    after(async () => {
        await robot.shutdown();
        await new Promise(resolve => {
            robot.fdsMockServer.close(resolve);
        });
    });

    it("advertises the mop pad and the dock detergent", () => {
        const consumables = robot.capabilities.ConsumableMonitoringCapability.getProperties().availableConsumables;

        assert.deepStrictEqual(
            consumables.map(c => {
                return `${c.type}/${c.subType}/${c.unit}`;
            }),
            [
                "brush/main/minutes",
                "brush/side_right/minutes",
                "filter/main/minutes",
                "cleaning/sensor/minutes",
                "mop/all/minutes",
                "detergent/dock/percent",
                "cleaning/wheel/minutes"
            ]
        );
    });

    it("polls siid 18 piid 2 (mop hours) and siid 20 piid 1 (detergent percent) as handled by fw 2199", async () => {
        respond = (method, args) => {
            return args.map(p => {
                return Object.assign({}, p, {code: 0, value: p.siid === 20 ? 42 : 10});
            });
        };

        const consumables = await robot.capabilities.ConsumableMonitoringCapability.getConsumables();
        const request = sentCommands.find(c => {
            return c.method === "get_properties";
        });

        assert.ok(request.args.some(p => {
            return p.siid === 18 && p.piid === 2;
        }));
        assert.ok(request.args.some(p => {
            return p.siid === 20 && p.piid === 1;
        }));

        const mop = consumables.find(c => {
            return c.type === ValetudoConsumable.TYPE.MOP;
        });
        const detergent = consumables.find(c => {
            return c.type === ValetudoConsumable.TYPE.DETERGENT;
        });

        assert.deepStrictEqual(mop.remaining, {value: 600, unit: ValetudoConsumable.UNITS.MINUTES});
        assert.deepStrictEqual(detergent.remaining, {value: 42, unit: ValetudoConsumable.UNITS.PERCENT});
    });

    it("skips consumables the firmware answers with an error code", async () => {
        respond = (method, args) => {
            return args.map(p => {
                return Object.assign({}, p, p.siid === 18 ? {code: -1} : {code: 0, value: 5});
            });
        };

        const consumables = await robot.capabilities.ConsumableMonitoringCapability.getConsumables();

        assert.strictEqual(consumables.some(c => {
            return c.type === ValetudoConsumable.TYPE.MOP;
        }), false);
        assert.strictEqual(consumables.some(c => {
            return c.type === ValetudoConsumable.TYPE.DETERGENT;
        }), true);
    });

    it("resets the mop pad and the detergent with action 1 of their services", async () => {
        sentCommands = [];
        respond = () => {
            return {code: 0};
        };

        await robot.capabilities.ConsumableMonitoringCapability.resetConsumable(ValetudoConsumable.TYPE.MOP, ValetudoConsumable.SUB_TYPE.ALL);
        await robot.capabilities.ConsumableMonitoringCapability.resetConsumable(ValetudoConsumable.TYPE.DETERGENT, ValetudoConsumable.SUB_TYPE.DOCK);

        assert.deepStrictEqual(
            sentCommands.map(c => {
                return [c.method, c.args.siid, c.args.aiid];
            }),
            [["action", 18, 1], ["action", 20, 1]]
        );
    });
});
