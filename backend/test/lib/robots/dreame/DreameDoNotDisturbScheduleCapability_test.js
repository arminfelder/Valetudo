const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, beforeEach, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_dnd_schedule_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameDoNotDisturbScheduleCapability = require("../../../../lib/robots/dreame/capabilities/DreameDoNotDisturbScheduleCapability");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const ValetudoDNDWindow = require("../../../../lib/entities/core/ValetudoDNDWindow");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

describe("DreameDoNotDisturbScheduleCapability", () => {
    describe("weekday mask", () => {
        it("uses bit 6 for Sunday and bit 0 for Saturday", () => {
            assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK([0]), 0b1000000);
            assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK([6]), 0b0000001);
            assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK([1, 2, 3, 4, 5]), 0b0111110);
            assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK([0, 1, 2, 3, 4, 5, 6]), 0x7f);
        });

        it("maps no days to 0 (once) and ignores duplicates", () => {
            assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK([]), 0);
            assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK([3, 3]), 0b0001000);
        });

        it("converts every mask back to the same days", () => {
            for (let mask = 0; mask <= 0x7f; mask++) {
                const dow = DreameDoNotDisturbScheduleCapability.CONVERT_FROM_WEEKDAY_MASK(mask);

                assert.strictEqual(DreameDoNotDisturbScheduleCapability.CONVERT_TO_WEEKDAY_MASK(dow), mask);
            }
        });
    });

    describe("on the X50", () => {
        /** @type {DreameX50UltraValetudoRobot} */
        let robot;
        /** @type {DreameDoNotDisturbScheduleCapability} */
        let capability;
        /** @type {Array<{method: string, args: any}>} */
        let sentCommands;
        /** @type {any} */
        let taskList;

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
                        return Object.assign({}, p, {code: 0, value: taskList});
                    });
                } else if (method === "set_properties") {
                    return args.map(p => {
                        return Object.assign({}, p, {code: 0});
                    });
                }

                return {code: 0};
            };

            capability = robot.capabilities.DoNotDisturbScheduleCapability;
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

        it("is registered next to the single-window DND capability", () => {
            assert.ok(capability instanceof DreameDoNotDisturbScheduleCapability);
            assert.ok(robot.capabilities.DoNotDisturbCapability);
        });

        it("reads siid 5 piid 4 and hides task 0", async () => {
            taskList = JSON.stringify([
                {id: 0, en: true, st: "22:00", et: "08:00", wk: 127, ss: 0},
                {id: 2, en: false, st: "13:30", et: "14:05", wk: 0, ss: 0},
                {id: 1, en: true, st: "21:00", et: "07:00", wk: 0b0111110, ss: 0}
            ]);

            const windows = await capability.getWindows();

            assert.deepStrictEqual(
                [sentCommands[0].method, sentCommands[0].args[0].siid, sentCommands[0].args[0].piid],
                ["get_properties", 5, 4]
            );
            assert.deepStrictEqual(JSON.parse(JSON.stringify(windows)), [
                {__class: "ValetudoDNDWindow", metaData: {}, id: 1, enabled: true, start: {hour: 21, minute: 0}, end: {hour: 7, minute: 0}, dow: [1, 2, 3, 4, 5]},
                {__class: "ValetudoDNDWindow", metaData: {}, id: 2, enabled: false, start: {hour: 13, minute: 30}, end: {hour: 14, minute: 5}, dow: []}
            ]);
        });

        it("treats a missing wk as every day, like the firmware", async () => {
            taskList = JSON.stringify([{id: 4, en: true, st: "01:00", et: "02:00"}]);

            assert.deepStrictEqual((await capability.getWindows())[0].dow, [0, 1, 2, 3, 4, 5, 6]);
        });

        it("accepts an empty task list", async () => {
            taskList = "";
            assert.deepStrictEqual(await capability.getWindows(), []);

            taskList = "[]";
            assert.deepStrictEqual(await capability.getWindows(), []);
        });

        it("rejects a task list that is not an array", async () => {
            taskList = JSON.stringify({id: 1});

            await assert.rejects(capability.getWindows(), /invalid DND task list/);
        });

        it("deletes removed windows with action 1, then writes the rest with new ids after the highest one", async () => {
            taskList = JSON.stringify([
                {id: 0, en: true, st: "22:00", et: "08:00", wk: 127, ss: 0},
                {id: 1, en: true, st: "21:00", et: "07:00", wk: 62, ss: 0},
                {id: 3, en: true, st: "10:00", et: "11:00", wk: 0, ss: 0},
                {id: 5, en: true, st: "12:00", et: "13:00", wk: 0, ss: 0}
            ]);

            await capability.setWindows([
                new ValetudoDNDWindow({id: 1, enabled: false, start: {hour: 21, minute: 0}, end: {hour: 7, minute: 0}, dow: [1, 2, 3, 4, 5]}),
                new ValetudoDNDWindow({enabled: true, start: {hour: 23, minute: 5}, end: {hour: 9, minute: 0}, dow: [0, 6]})
            ]);

            const action = sentCommands.find(c => {
                return c.method === "action";
            });
            assert.deepStrictEqual(
                {siid: action.args.siid, aiid: action.args.aiid, in: action.args.in},
                {siid: 5, aiid: 1, in: [{piid: 4, value: "3,5"}]}
            );

            const write = sentCommands.find(c => {
                return c.method === "set_properties";
            });
            assert.strictEqual(write.args[0].siid, 5);
            assert.strictEqual(write.args[0].piid, 4);
            assert.deepStrictEqual(JSON.parse(write.args[0].value), [
                {id: 1, en: false, st: "21:00", et: "07:00", wk: 0b0111110},
                {id: 6, en: true, st: "23:05", et: "09:00", wk: 0b1000001}
            ]);

            assert.ok(
                sentCommands.indexOf(action) < sentCommands.indexOf(write),
                "delete is sent before the write"
            );
        });

        it("never deletes task 0 and sends no write for an empty list", async () => {
            taskList = JSON.stringify([
                {id: 0, en: true, st: "22:00", et: "08:00", wk: 127, ss: 0},
                {id: 7, en: true, st: "10:00", et: "11:00", wk: 0, ss: 0}
            ]);

            await capability.setWindows([]);

            assert.deepStrictEqual(
                sentCommands.filter(c => {
                    return c.method !== "get_properties";
                }).map(c => {
                    return [c.method, c.args.in];
                }),
                [["action", [{piid: 4, value: "7"}]]]
            );
        });

        it("sends nothing but the read when nothing has to be removed or written", async () => {
            taskList = JSON.stringify([{id: 0, en: true, st: "22:00", et: "08:00", wk: 127, ss: 0}]);

            await capability.setWindows([]);

            assert.deepStrictEqual(sentCommands.map(c => {
                return c.method;
            }), ["get_properties"]);
        });

        it("refuses window id 0 and more windows than maxWindows", async () => {
            taskList = "[]";

            await assert.rejects(
                capability.setWindows([new ValetudoDNDWindow({id: 0, enabled: true, start: {hour: 1, minute: 0}, end: {hour: 2, minute: 0}, dow: []})]),
                /reserved/
            );

            const tooMany = Array.from({length: capability.getProperties().maxWindows + 1}, () => {
                return new ValetudoDNDWindow({enabled: true, start: {hour: 1, minute: 0}, end: {hour: 2, minute: 0}, dow: []});
            });
            await assert.rejects(capability.setWindows(tooMany), /At most/);
            assert.strictEqual(sentCommands.some(c => {
                return c.method === "set_properties" || c.method === "action";
            }), false);
        });
    });
});
