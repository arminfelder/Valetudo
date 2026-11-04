const assert = require("node:assert");
const { describe, it } = require("node:test");

const MqttController = require("../../../lib/mqtt/MqttController");

describe("MqttController", () => {
    it("does not call withHass callbacks if Home Assistant is disabled", async () => {
        const fakeController = {hassController: null};
        let calls = 0;

        MqttController.prototype.withHass.call(fakeController, () => {
            calls++;
        });
        await MqttController.prototype.withHassAsync.call(fakeController, async () => {
            calls++;
        });

        assert.strictEqual(calls, 0);
    });

    it("calls withHass callbacks with the HassController if Home Assistant is enabled", async () => {
        const hassController = {};
        const fakeController = {hassController: hassController};
        const received = [];

        MqttController.prototype.withHass.call(fakeController, (hass) => {
            received.push(hass);
        });
        await MqttController.prototype.withHassAsync.call(fakeController, async (hass) => {
            received.push(hass);
        });

        assert.deepStrictEqual(received, [hassController, hassController]);
    });
});
