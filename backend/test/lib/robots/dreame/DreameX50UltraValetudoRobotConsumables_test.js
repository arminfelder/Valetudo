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
                "cleaning/wheel/minutes",
                "silver_ion/dock/minutes",
                "deodorant/dock/minutes",
                "scale_inhibitor/dock/minutes",
                "cleaning/wash_tray/minutes",
                "cleaning/dirty_water_tank/minutes"
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

    it("polls piid 1 of the dock consumables and converts days and hours to minutes", async () => {
        sentCommands = [];
        respond = (method, args) => {
            return args.map(p => {
                return Object.assign({}, p, {code: 0, value: {19: 300, 25: 12, 26: 100, 29: 1, 31: 0}[p.siid] ?? 10});
            });
        };

        const consumables = await robot.capabilities.ConsumableMonitoringCapability.getConsumables();
        const polled = sentCommands.find(c => {
            return c.method === "get_properties";
        }).args.map(p => {
            return `${p.siid}.${p.piid}`;
        });

        for (const siid of [19, 25, 26, 29, 31]) {
            assert.ok(polled.includes(`${siid}.1`), `siid ${siid} piid 1 is polled`);
        }

        const byName = Object.fromEntries(consumables.map(c => {
            return [`${c.type}/${c.subType}`, c.remaining];
        }));

        assert.deepStrictEqual(byName["silver_ion/dock"], {value: 300 * 24 * 60, unit: "minutes"});
        assert.deepStrictEqual(byName["deodorant/dock"], {value: 24 * 60, unit: "minutes"});
        assert.deepStrictEqual(byName["scale_inhibitor/dock"], {value: 0, unit: "minutes"});
        assert.deepStrictEqual(byName["cleaning/wash_tray"], {value: 12 * 60, unit: "minutes"});
        assert.deepStrictEqual(byName["cleaning/dirty_water_tank"], {value: 100 * 60, unit: "minutes"});
    });

    it("leaves out dock consumables that the firmware reports as not installed (-2)", async () => {
        respond = (method, args) => {
            return args.map(p => {
                return Object.assign({}, p, {code: 0, value: [19, 29].includes(p.siid) ? -2 : 10});
            });
        };

        const consumables = await robot.capabilities.ConsumableMonitoringCapability.getConsumables();
        const types = consumables.map(c => {
            return c.type;
        });

        assert.strictEqual(types.includes(ValetudoConsumable.TYPE.SILVER_ION), false);
        assert.strictEqual(types.includes(ValetudoConsumable.TYPE.DEODORANT), false);
        assert.strictEqual(types.includes(ValetudoConsumable.TYPE.SCALE_INHIBITOR), true);
    });

    it("resets each dock consumable with action 1 of its service", async () => {
        sentCommands = [];
        respond = () => {
            return {code: 0};
        };

        const cap = robot.capabilities.ConsumableMonitoringCapability;
        await cap.resetConsumable(ValetudoConsumable.TYPE.SILVER_ION, ValetudoConsumable.SUB_TYPE.DOCK);
        await cap.resetConsumable(ValetudoConsumable.TYPE.DEODORANT, ValetudoConsumable.SUB_TYPE.DOCK);
        await cap.resetConsumable(ValetudoConsumable.TYPE.SCALE_INHIBITOR, ValetudoConsumable.SUB_TYPE.DOCK);
        await cap.resetConsumable(ValetudoConsumable.TYPE.CLEANING, ValetudoConsumable.SUB_TYPE.WASH_TRAY);
        await cap.resetConsumable(ValetudoConsumable.TYPE.CLEANING, ValetudoConsumable.SUB_TYPE.DIRTY_WATER_TANK);

        assert.deepStrictEqual(
            sentCommands.map(c => {
                return [c.method, c.args.siid, c.args.aiid];
            }),
            [["action", 19, 1], ["action", 29, 1], ["action", 31, 1], ["action", 25, 1], ["action", 26, 1]]
        );
    });

    it("still rejects a reset of a consumable the robot does not have", async () => {
        await assert.rejects(
            robot.capabilities.ConsumableMonitoringCapability.resetConsumable(ValetudoConsumable.TYPE.SILVER_ION, ValetudoConsumable.SUB_TYPE.MAIN),
            /No such consumable/
        );
    });

    it("parses pushed property changes of the dock consumables", () => {
        const consumable = robot.capabilities.ConsumableMonitoringCapability.parseConsumablesMessage({siid: 31, piid: 1, value: 1095});

        assert.strictEqual(consumable.type, ValetudoConsumable.TYPE.SCALE_INHIBITOR);
        assert.deepStrictEqual(consumable.remaining, {value: 1095 * 24 * 60, unit: "minutes"});
        assert.strictEqual(
            robot.capabilities.ConsumableMonitoringCapability.parseConsumablesMessage({siid: 31, piid: 2, value: 100}),
            undefined,
            "piid 2 (percent) is not used"
        );
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
