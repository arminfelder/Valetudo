const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it, mock } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_initial_poll_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameGen2ValetudoRobot = require("../../../../lib/robots/dreame/DreameGen2ValetudoRobot");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const stateAttrs = require("../../../../lib/entities/state/attributes");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

describe("DreameX50UltraValetudoRobot initial state poll", () => {
    /** @type {DreameX50UltraValetudoRobot} */
    let robot;
    /** @type {Array<{method: string, args: any}>} */
    let sentCommands;

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

            if (method === "get_properties") {
                return args.map(p => {
                    let value = 0;
                    if (p.siid === 4 && p.piid === 18) {
                        value = "0";
                    } else if (p.siid === 4 && p.piid === 35) {
                        value = 101; // live: dust bag full
                    }

                    return Object.assign({}, p, {code: 0, value: value});
                });
            }

            return {code: 0};
        };
        robot.pollMap = () => {};
    });

    after(async () => {
        mock.timers.reset();
        await robot.shutdown();
        await new Promise(resolve => {
            robot.fdsMockServer.close(resolve);
        });
    });

    it("polls the state once after the robot connected, so an unchanged dock warning shows up without MQTT", async () => {
        mock.timers.enable({apis: ["setTimeout"]});

        robot.onCloudConnected();
        assert.strictEqual(sentCommands.some(c => {
            return c.method === "get_properties";
        }), false, "nothing before the delay");

        mock.timers.tick(DreameGen2ValetudoRobot.INITIAL_STATE_POLL_DELAY);
        mock.timers.reset();
        await new Promise(resolve => {
            setImmediate(resolve);
        });

        const poll = sentCommands.find(c => {
            return c.method === "get_properties";
        });
        assert.ok(poll, "state poll sent");
        assert.ok(poll.args.some(p => {
            return p.siid === 4 && p.piid === 35;
        }), "the poll contains 4.35");

        const status = robot.state.getFirstMatchingAttribute({attributeClass: stateAttrs.StatusStateAttribute.name});
        assert.strictEqual(status.value, stateAttrs.StatusStateAttribute.VALUE.ERROR);
        assert.match(status.error.message, /dust bag full/);
    });

    it("logs and survives a failed initial poll", async () => {
        const failing = robot.sendCommand;
        robot.sendCommand = async () => {
            throw new Error("not connected");
        };
        mock.timers.enable({apis: ["setTimeout"]});

        robot.onCloudConnected();
        mock.timers.tick(DreameGen2ValetudoRobot.INITIAL_STATE_POLL_DELAY);
        mock.timers.reset();
        await new Promise(resolve => {
            setImmediate(resolve);
        });

        robot.sendCommand = failing;
    });
});
