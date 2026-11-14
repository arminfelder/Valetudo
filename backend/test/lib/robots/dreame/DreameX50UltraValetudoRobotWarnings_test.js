const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, before, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_x50_warnings_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const stateAttrs = require("../../../../lib/entities/state/attributes");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");

describe("DreameX50UltraValetudoRobot dock warnings (siid 4 piid 35)", () => {
    /** @type {DreameX50UltraValetudoRobot} */
    let robot;
    /** @type {ValetudoEventStore} */
    let eventStore;

    before(() => {
        eventStore = new ValetudoEventStore();
        robot = new DreameX50UltraValetudoRobot({
            config: new Configuration(),
            valetudoEventStore: eventStore
        });

        // The getter reads the device.conf of the robot, which does not exist here
        Object.defineProperty(robot, "deviceId", {value: 123456789});
        robot.sendCommand = async () => {
            return [];
        };
    });

    after(async () => {
        await robot.shutdown();
        await new Promise(resolve => {
            robot.fdsMockServer.close(resolve);
        });
    });

    /**
     * @param {Array<{siid: number, piid: number, value: any}>} props
     * @returns {import("../../../../lib/entities/state/attributes/StatusStateAttribute")}
     */
    function update(props) {
        robot.parseAndUpdateState(props);

        return robot.state.getFirstMatchingAttribute({attributeClass: stateAttrs.StatusStateAttribute.name});
    }

    it("polls siid 4 piid 35", () => {
        assert.ok(robot.statePropertiesToPoll.some(p => {
            return p.siid === 4 && p.piid === 35;
        }));
    });

    it("shows warning 101 (live: dust bag full) as a dock error while 4.18 has no error", () => {
        const status = update([
            {siid: 4, piid: 18, value: "0"},
            {siid: 4, piid: 35, value: 101}
        ]);

        assert.strictEqual(status.value, stateAttrs.StatusStateAttribute.VALUE.ERROR);
        assert.strictEqual(status.error.subsystem, "dock");
        assert.match(status.error.message, /dust bag full/);
    });

    it("raises an error event once, which drives the notification and MQTT error description", () => {
        const events = Object.values(eventStore.getAll()).filter(e => {
            return e.__class === "ErrorStateValetudoEvent" || e.constructor.name === "ErrorStateValetudoEvent";
        });

        assert.ok(events.some(e => {
            return /dust bag full/.test(e.message);
        }));
    });

    it("clears the error when the warning goes back to 0", () => {
        const status = update([{siid: 4, piid: 35, value: 0}]);

        assert.notStrictEqual(status.value, stateAttrs.StatusStateAttribute.VALUE.ERROR);
    });

    it("maps the dock water warnings with the existing texts", () => {
        assert.match(update([{siid: 4, piid: 35, value: 107}]).error.message, /Clean Water Tank empty/);
        assert.match(update([{siid: 4, piid: 35, value: 106}]).error.message, /Wastewater Tank not installed or full/);
        update([{siid: 4, piid: 35, value: 0}]);
    });

    it("lets a real error in 4.18 win over a warning", () => {
        const status = update([
            {siid: 4, piid: 18, value: "1"},
            {siid: 4, piid: 35, value: 101}
        ]);

        assert.strictEqual(status.value, stateAttrs.StatusStateAttribute.VALUE.ERROR);
        assert.doesNotMatch(status.error.message, /dust bag/);

        update([{siid: 4, piid: 18, value: "0"}, {siid: 4, piid: 35, value: 0}]);
    });

    it("treats the reminder codes the same way for warnings as for errors (114: docked)", () => {
        const status = update([{siid: 4, piid: 35, value: 114}]);

        assert.strictEqual(status.value, stateAttrs.StatusStateAttribute.VALUE.DOCKED);
        update([{siid: 4, piid: 35, value: 0}]);
    });
});
