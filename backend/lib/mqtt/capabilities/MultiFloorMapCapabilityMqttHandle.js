const CapabilityMqttHandle = require("./CapabilityMqttHandle");

const Commands = require("../common/Commands");
const ComponentType = require("../homeassistant/ComponentType");
const DataType = require("../homie/DataType");
const EntityCategory = require("../homeassistant/EntityCategory");
const HassAnchor = require("../homeassistant/HassAnchor");
const InLineHassComponent = require("../homeassistant/components/InLineHassComponent");
const Logger = require("../../Logger");
const PropertyMqttHandle = require("../handles/PropertyMqttHandle");

class MultiFloorMapCapabilityMqttHandle extends CapabilityMqttHandle {
    /**
     * @param {object} options
     * @param {import("../handles/RobotMqttHandle")} options.parent
     * @param {import("../MqttController")} options.controller MqttController instance
     * @param {import("../../core/ValetudoRobot")} options.robot
     * @param {import("../../core/capabilities/MultiFloorMapCapability")} options.capability
     */
    constructor(options) {
        super(Object.assign(options, {
            friendlyName: "Floor maps",
            helpMayChange: {
                "Map names": "The list of stored maps changes when maps are added, renamed or deleted on the robot."
            }
        }));
        this.capability = options.capability;

        /** @type {Array<string>} */
        this.mapLabels = [];

        this.registerChild(
            new PropertyMqttHandle({
                parent: this,
                controller: this.controller,
                topicName: "map",
                friendlyName: "Floor map",
                datatype: DataType.STRING,
                setter: async (value) => {
                    const maps = await this.capability.getMaps();
                    const map = MultiFloorMapCapabilityMqttHandle.FIND_MAP(maps, value);

                    if (!map) {
                        throw new Error(`No stored map "${value}"`);
                    }

                    await this.capability.selectMap(map.id);
                },
                getter: async () => {
                    const maps = await this.capability.getMaps();
                    const labels = MultiFloorMapCapabilityMqttHandle.LABELS(maps);

                    await this.postMapLabels(labels.map(l => {
                        return l.label;
                    }));

                    return labels.find(l => {
                        return l.map.active;
                    })?.label ?? null;
                },
                helpText: "This handle shows the map that the robot uses now. " +
                    "Publish the name or the id of a stored map to make the robot use it. " +
                    "Move the robot and its dock to that floor first."
            }).also((prop) => {
                this.controller.withHass((hass) => {
                    prop.attachHomeAssistantComponent(
                        new InLineHassComponent({
                            hass: hass,
                            robot: this.robot,
                            name: this.capability.getType() + "_map",
                            friendlyName: "Floor map",
                            componentType: ComponentType.SELECT,
                            autoconf: {
                                state_topic: prop.getBaseTopic(),
                                value_template: "{{ value }}",
                                command_topic: prop.getBaseTopic() + "/set",
                                options: this.controller.hassAnchorProvider.getTopicReference(
                                    HassAnchor.REFERENCE.FLOOR_MAP_OPTIONS
                                ),
                                icon: "mdi:floor-plan"
                            }
                        })
                    );
                });
            })
        );

        this.registerChild(
            new PropertyMqttHandle({
                parent: this,
                controller: this.controller,
                topicName: "enabled",
                friendlyName: "Multi-floor maps",
                datatype: DataType.ENUM,
                format: Object.values(Commands.SWITCH).join(","),
                setter: async (value) => {
                    if (value === Commands.SWITCH.ON) {
                        await this.capability.setEnabled(true);
                    } else if (value === Commands.SWITCH.OFF) {
                        await this.capability.setEnabled(false);
                    } else {
                        throw new Error("Invalid value");
                    }
                },
                getter: async () => {
                    return (await this.capability.isEnabled()) ? Commands.SWITCH.ON : Commands.SWITCH.OFF;
                }
            }).also((prop) => {
                this.controller.withHass((hass) => {
                    prop.attachHomeAssistantComponent(
                        new InLineHassComponent({
                            hass: hass,
                            robot: this.robot,
                            name: this.capability.getType() + "_enabled",
                            friendlyName: "Multi-floor maps",
                            componentType: ComponentType.SWITCH,
                            autoconf: {
                                state_topic: prop.getBaseTopic(),
                                value_template: "{{ value }}",
                                command_topic: prop.getBaseTopic() + "/set",
                                icon: "mdi:layers-triple",
                                entity_category: EntityCategory.CONFIG
                            }
                        })
                    );
                });
            })
        );
    }

    /**
     * The anchor notifies on every new array, which republishes the discovery. Post only on a change.
     *
     * @private
     * @param {Array<string>} labels
     * @returns {Promise<void>}
     */
    async postMapLabels(labels) {
        if (labels.length === 0 || JSON.stringify(labels) === JSON.stringify(this.mapLabels)) {
            return;
        }

        this.mapLabels = labels;

        try {
            await this.controller.hassAnchorProvider.getTopicReference(
                HassAnchor.REFERENCE.FLOOR_MAP_OPTIONS
            ).post(labels);
        } catch (err) {
            Logger.error("Error while posting value to HassAnchor", err);
        }
    }

    /**
     * A unique label per map: the name, "Map <id>" without a name, the name with the id for duplicate names.
     *
     * @param {Array<import("../../entities/core/ValetudoFloorMap")>} maps
     * @returns {Array<{label: string, map: import("../../entities/core/ValetudoFloorMap")}>}
     */
    static LABELS(maps) {
        return maps.map(map => {
            const sameName = maps.filter(m => {
                return m.name !== undefined && m.name === map.name;
            });

            let label = map.name ?? `Map ${map.id}`;
            if (sameName.length > 1) {
                label = `${map.name} (${map.id})`;
            }

            return {label: label, map: map};
        });
    }

    /**
     * @param {Array<import("../../entities/core/ValetudoFloorMap")>} maps
     * @param {string} value A label or a map id
     * @returns {import("../../entities/core/ValetudoFloorMap") | undefined}
     */
    static FIND_MAP(maps, value) {
        const trimmed = `${value}`.trim();

        return MultiFloorMapCapabilityMqttHandle.LABELS(maps).find(l => {
            return l.label === trimmed;
        })?.map ?? maps.find(m => {
            return `${m.id}` === trimmed;
        });
    }
}

module.exports = MultiFloorMapCapabilityMqttHandle;
