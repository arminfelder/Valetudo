const assert = require("node:assert");
const { beforeEach, describe, it } = require("node:test");

const ComponentType = require("../../../../lib/mqtt/homeassistant/ComponentType");
const HassAnchor = require("../../../../lib/mqtt/homeassistant/HassAnchor");
const HassAnchorProvider = require("../../../../lib/mqtt/homeassistant/HassAnchorProvider");
const HassController = require("../../../../lib/mqtt/homeassistant/HassController");
const InLineHassComponent = require("../../../../lib/mqtt/homeassistant/components/InLineHassComponent");

const DEVICE_TOPIC = "homeassistant/device/valetudo_testrobot/config";

function createFakeController() {
    return {
        currentConfig: {
            customizations: {topicPrefix: "valetudo"},
            identity: {identifier: "TestRobot"},
            qos: 1
        },
        hassAnchorProvider: new HassAnchorProvider(),
        published: [],
        publishHass: async function(topic, message, options) {
            this.published.push({topic: topic, message: message, options: options});
        },
        subscribe: async function() {},
        unsubscribe: async function() {}
    };
}

function createHassController(controller, previousComponents) {
    return new HassController({
        controller: controller,
        robot: {
            getManufacturer: () => {
                return "Dreame";
            },
            getModelName: () => {
                return "X50 Ultra";
            }
        },
        config: {
            get: () => {
                return {};
            }
        },
        friendlyName: "Test Robot",
        previousComponents: previousComponents
    });
}

function createFakeComponent(componentType, name) {
    return {
        componentId: "TestRobot_" + componentType + "_" + name,
        componentType: componentType,
        getAutoconfTopic: () => {
            return "homeassistant/" + componentType + "/TestRobot/TestRobot_" + componentType + "_" + name + "/config";
        }
    };
}

function devicePublications(controller) {
    return controller.published.filter(p => {
        return p.topic === DEVICE_TOPIC;
    });
}

describe("HassController", () => {
    let controller;
    let hass;

    beforeEach(async () => {
        controller = createFakeController();
        await controller.hassAnchorProvider.getTopicReference(HassAnchor.REFERENCE.AVAILABILITY).post("valetudo/TestRobot/$state");

        hass = createHassController(controller);
    });

    it("publishes all components as one device discovery message on configure", async () => {
        const battery = createFakeComponent(ComponentType.SENSOR, "battery");
        const vacuum = createFakeComponent(ComponentType.VACUUM, "vacuum");

        await hass.refreshAutoconf(battery, {unique_id: battery.componentId, state_topic: "a"});
        await hass.refreshAutoconf(vacuum, {unique_id: vacuum.componentId, command_topic: "b"});
        assert.strictEqual(devicePublications(controller).length, 0);

        await hass.configure();

        const publications = devicePublications(controller);
        assert.strictEqual(publications.length, 1);
        assert.deepStrictEqual(publications[0].options, {qos: 1, retain: true});

        const payload = JSON.parse(publications[0].message);
        assert.strictEqual(payload.device.name, "Test Robot");
        assert.deepStrictEqual(payload.device.identifiers, ["TestRobot"]);
        assert.strictEqual(payload.origin.name, "Valetudo");
        assert.strictEqual(payload.availability_topic, "valetudo/TestRobot/$state");
        assert.strictEqual(payload.payload_available, "ready");
        assert.strictEqual(payload.payload_not_available, "lost");
        assert.deepStrictEqual(payload.components, {
            [battery.componentId]: {platform: "sensor", unique_id: battery.componentId, state_topic: "a"},
            [vacuum.componentId]: {platform: "vacuum", unique_id: vacuum.componentId, command_topic: "b"}
        });
    });

    it("keeps unique_id and leaves device and availability out of the component config", async () => {
        const component = new InLineHassComponent({
            hass: hass,
            robot: null,
            name: "battery_level",
            friendlyName: "Battery level",
            componentType: ComponentType.SENSOR,
            autoconf: {state_topic: "valetudo/TestRobot/BatteryStateAttribute/level"}
        });

        await component.configure();
        await hass.configure();

        const payload = JSON.parse(devicePublications(controller)[0].message);
        const config = payload.components["TestRobot_sensor_battery_level"];

        assert.strictEqual(config.unique_id, "TestRobot_sensor_battery_level");
        assert.strictEqual(config.platform, "sensor");
        assert.strictEqual(config.device, undefined);
        assert.strictEqual(config.availability_topic, undefined);
    });

    it("migrates the legacy per-component topics around the first device discovery", async () => {
        const battery = createFakeComponent(ComponentType.SENSOR, "battery");

        await hass.refreshAutoconf(battery, {unique_id: battery.componentId});
        await hass.configure();

        assert.deepStrictEqual(controller.published.map(p => {
            return [p.topic, p.message, p.options.retain];
        }), [
            [battery.getAutoconfTopic(), "{\"migrate_discovery\":true}", true],
            [DEVICE_TOPIC, controller.published[1].message, true],
            [battery.getAutoconfTopic(), "", true]
        ]);

        controller.published = [];
        await hass.configure();

        assert.deepStrictEqual(controller.published.map(p => {
            return p.topic;
        }), [DEVICE_TOPIC]);
    });

    it("collapses component updates after configure into one delayed publication", async (t) => {
        t.mock.timers.enable({apis: ["setTimeout"]});

        const battery = createFakeComponent(ComponentType.SENSOR, "battery");
        const vacuum = createFakeComponent(ComponentType.VACUUM, "vacuum");

        await hass.refreshAutoconf(battery, {unique_id: battery.componentId});
        await hass.configure();
        controller.published = [];

        await hass.refreshAutoconf(battery, {unique_id: battery.componentId, name: "new"});
        await hass.refreshAutoconf(vacuum, {unique_id: vacuum.componentId});
        assert.strictEqual(controller.published.length, 0);

        t.mock.timers.tick(HassController.DISCOVERY_PUBLISH_DELAY);
        await new Promise(setImmediate);

        const publications = devicePublications(controller);
        assert.strictEqual(publications.length, 1);
        assert.deepStrictEqual(Object.keys(JSON.parse(publications[0].message).components), [battery.componentId, vacuum.componentId]);
    });

    it("removes components that a previous controller published but this one does not have", async () => {
        const battery = createFakeComponent(ComponentType.SENSOR, "battery");
        const stale = createFakeComponent(ComponentType.SELECT, "stale");

        hass = createHassController(controller, new Map([
            [battery.componentId, "sensor"],
            [stale.componentId, "select"]
        ]));

        await hass.refreshAutoconf(battery, {unique_id: battery.componentId});
        await hass.configure();

        const publications = devicePublications(controller);
        assert.strictEqual(publications.length, 2);
        assert.deepStrictEqual(JSON.parse(publications[0].message).components[stale.componentId], {platform: "select"});
        assert.deepStrictEqual(Object.keys(JSON.parse(publications[1].message).components), [battery.componentId]);

        // A previous controller of this process has already migrated the legacy topics
        assert.strictEqual(controller.published.length, 2);
        assert.deepStrictEqual([...hass.getPublishedComponents().keys()], [battery.componentId]);
    });

    it("removes the device with an empty retained payload", async () => {
        await hass.removeDevice();

        assert.deepStrictEqual(controller.published, [
            {topic: DEVICE_TOPIC, message: "", options: {qos: 1, retain: true}}
        ]);
    });

    it("does not publish after deconfigure", async (t) => {
        t.mock.timers.enable({apis: ["setTimeout"]});

        const battery = createFakeComponent(ComponentType.SENSOR, "battery");

        await hass.refreshAutoconf(battery, {unique_id: battery.componentId});
        await hass.configure();
        await hass.refreshAutoconf(battery, {unique_id: battery.componentId, name: "new"});
        await hass.deconfigure({unsubscribe: true});
        controller.published = [];

        t.mock.timers.tick(HassController.DISCOVERY_PUBLISH_DELAY);
        await new Promise(setImmediate);

        assert.strictEqual(controller.published.length, 0);
    });
});
