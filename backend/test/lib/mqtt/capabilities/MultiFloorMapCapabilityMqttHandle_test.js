const assert = require("node:assert");
const { beforeEach, describe, it } = require("node:test");

const ComponentType = require("../../../../lib/mqtt/homeassistant/ComponentType");
const HandleMappings = require("../../../../lib/mqtt/handles/HandleMappings");
const HassAnchor = require("../../../../lib/mqtt/homeassistant/HassAnchor");
const HassAnchorProvider = require("../../../../lib/mqtt/homeassistant/HassAnchorProvider");
const HassController = require("../../../../lib/mqtt/homeassistant/HassController");
const MultiFloorMapCapability = require("../../../../lib/core/capabilities/MultiFloorMapCapability");
const MultiFloorMapCapabilityMqttHandle = require("../../../../lib/mqtt/capabilities/MultiFloorMapCapabilityMqttHandle");
const ValetudoFloorMap = require("../../../../lib/entities/core/ValetudoFloorMap");

/**
 * @param {number} id
 * @param {string|undefined} name
 * @param {boolean} active
 * @returns {ValetudoFloorMap}
 */
function floorMap(id, name, active) {
    return new ValetudoFloorMap({id: id, name: name, active: active, segments: []});
}

describe("MultiFloorMapCapabilityMqttHandle", () => {
    let handle;
    let capability;
    let anchorProvider;

    beforeEach(() => {
        anchorProvider = new HassAnchorProvider();
        capability = {
            maps: [floorMap(120, undefined, true), floorMap(121, "Attic", false)],
            enabled: true,
            selected: [],
            enabledWrites: [],
            getType: () => {
                return MultiFloorMapCapability.TYPE;
            },
            getMaps: async function() {
                return this.maps;
            },
            isEnabled: async function() {
                return this.enabled;
            },
            setEnabled: async function(v) {
                this.enabledWrites.push(v);
            },
            selectMap: async function(id) {
                this.selected.push(id);
            }
        };

        const hass = {
            identifier: "TestRobot",
            objectId: "testrobot",
            getBaseTopic: () => {
                return "valetudo/TestRobot/hass";
            }
        };

        handle = new MultiFloorMapCapabilityMqttHandle({
            parent: {
                getBaseTopic: () => {
                    return "valetudo/TestRobot";
                }
            },
            controller: {
                hassAnchorProvider: anchorProvider,
                isInitialized: false,
                withHass: (callback) => {
                    callback(hass);
                }
            },
            robot: {},
            capability: capability
        });
    });

    /**
     * @param {string} topicName
     * @returns {any}
     */
    function child(topicName) {
        return handle.children.find(c => {
            return c.topicName === topicName;
        });
    }

    it("is mapped to the MultiFloorMapCapability and exposed by default", () => {
        assert.strictEqual(
            HandleMappings.CAPABILITY_TYPE_TO_HANDLE_MAPPING[MultiFloorMapCapability.TYPE],
            MultiFloorMapCapabilityMqttHandle
        );
        assert.notStrictEqual(MultiFloorMapCapabilityMqttHandle.OPTIONAL, true);
    });

    it("publishes the active map as state and the labels as select options", async () => {
        assert.strictEqual(await child("map").getter(), "Map 120");
        assert.deepStrictEqual(
            anchorProvider.getTopicReference(HassAnchor.REFERENCE.FLOOR_MAP_OPTIONS).getValue(),
            ["Map 120", "Attic"]
        );
    });

    it("posts the options only when they change, so the discovery is not resent on each refresh", async () => {
        const reference = anchorProvider.getTopicReference(HassAnchor.REFERENCE.FLOOR_MAP_OPTIONS);
        let notifications = 0;
        reference.subscribe({
            onAnchorPost: async () => {
                notifications++;
            }
        });

        await child("map").getter();
        await child("map").getter();
        assert.strictEqual(notifications, 1);

        capability.maps = [floorMap(120, "Ground floor", true), floorMap(121, "Attic", false)];
        await child("map").getter();
        assert.strictEqual(notifications, 2);
        assert.deepStrictEqual(reference.getValue(), ["Ground floor", "Attic"]);
    });

    it("does not post an empty option list, which Home Assistant rejects", async () => {
        capability.maps = [];

        assert.strictEqual(await child("map").getter(), null);
        assert.strictEqual(anchorProvider.getTopicReference(HassAnchor.REFERENCE.FLOOR_MAP_OPTIONS).getValue(), null);
    });

    it("selects a map by label or by id", async () => {
        await child("map").setter("Attic");
        await child("map").setter("120");
        await child("map").setter(" 121 ");

        assert.deepStrictEqual(capability.selected, [121, 120, 121]);
        await assert.rejects(child("map").setter("Basement"), /No stored map "Basement"/);
    });

    it("gives duplicate names the map id, so each option is unique", () => {
        const labels = MultiFloorMapCapabilityMqttHandle.LABELS([
            floorMap(1, "Floor", true),
            floorMap(2, "Floor", false),
            floorMap(3, undefined, false)
        ]).map(l => {
            return l.label;
        });

        assert.deepStrictEqual(labels, ["Floor (1)", "Floor (2)", "Map 3"]);
    });

    it("switches multi-floor maps with ON and OFF", async () => {
        assert.strictEqual(await child("enabled").getter(), "ON");
        capability.enabled = false;
        assert.strictEqual(await child("enabled").getter(), "OFF");

        await child("enabled").setter("ON");
        await child("enabled").setter("OFF");
        assert.deepStrictEqual(capability.enabledWrites, [true, false]);
        await assert.rejects(child("enabled").setter("maybe"), /Invalid value/);
    });

    it("publishes the select in the device discovery once the options are known, and again when they change", async () => {
        const published = [];
        const fakeMqtt = {
            currentConfig: {
                customizations: {topicPrefix: "valetudo"},
                identity: {identifier: "TestRobot"},
                qos: 1
            },
            hassAnchorProvider: anchorProvider,
            publishHass: async (topic, message) => {
                published.push({topic: topic, message: message});
            },
            subscribe: async () => {},
            unsubscribe: async () => {}
        };
        await anchorProvider.getTopicReference(HassAnchor.REFERENCE.AVAILABILITY).post("valetudo/TestRobot/$state");
        const hass = new HassController({
            controller: fakeMqtt,
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
            friendlyName: "Test Robot"
        });
        const realHandle = new MultiFloorMapCapabilityMqttHandle({
            parent: {
                getBaseTopic: () => {
                    return "valetudo/TestRobot";
                }
            },
            controller: {
                hassAnchorProvider: anchorProvider,
                isInitialized: false,
                withHass: (callback) => {
                    callback(hass);
                }
            },
            robot: {},
            capability: capability
        });
        const mapProp = realHandle.children.find(c => {
            return c.topicName === "map";
        });
        const waitForPublish = () => {
            return new Promise(resolve => {
                setTimeout(resolve, HassController.DISCOVERY_PUBLISH_DELAY + 100);
            });
        };
        const selectConfig = () => {
            const device = published.filter(p => {
                return p.topic.startsWith("homeassistant/device/");
            }).pop();
            if (!device) {
                return undefined;
            }

            return Object.values(JSON.parse(device.message).cmps ?? JSON.parse(device.message).components ?? {}).find(c => {
                return c.platform === ComponentType.SELECT;
            });
        };

        await mapProp.hassComponents[0].configure();
        await hass.configure();
        await waitForPublish();
        assert.strictEqual(selectConfig(), undefined, "no select before the options are known");

        await mapProp.getter();
        await waitForPublish();
        assert.deepStrictEqual(selectConfig().options, ["Map 120", "Attic"]);

        capability.maps = [floorMap(120, "Ground floor", true), floorMap(121, "Attic", false)];
        await mapProp.getter();
        await waitForPublish();
        assert.deepStrictEqual(selectConfig().options, ["Ground floor", "Attic"]);
    });

    it("attaches a select and a switch with the options as a topic reference", () => {
        const select = child("map").hassComponents[0];
        const toggle = child("enabled").hassComponents[0];

        assert.strictEqual(select.componentType, ComponentType.SELECT);
        assert.strictEqual(select.autoconf.command_topic, "valetudo/TestRobot/MultiFloorMapCapability/map/set");
        assert.ok(select.autoconf.options instanceof HassAnchor);
        assert.strictEqual(toggle.componentType, ComponentType.SWITCH);
        assert.strictEqual(toggle.autoconf.state_topic, "valetudo/TestRobot/MultiFloorMapCapability/enabled");
    });
});
