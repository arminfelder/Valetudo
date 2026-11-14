const ConsumableMonitoringCapability = require("../../../core/capabilities/ConsumableMonitoringCapability");

const ValetudoConsumable = require("../../../entities/core/ValetudoConsumable");

/**
 * @extends ConsumableMonitoringCapability<import("../DreameValetudoRobot")>
 */
class DreameConsumableMonitoringCapability extends ConsumableMonitoringCapability {
    /**
     *
     * @param {object} options
     * @param {import("../DreameValetudoRobot")} options.robot
     *
     * @param {object} options.miot_actions
     * @param {object} options.miot_actions.reset_main_brush
     * @param {number} options.miot_actions.reset_main_brush.siid
     * @param {number} options.miot_actions.reset_main_brush.aiid
     *
     * @param {object} options.miot_actions.reset_side_brush
     * @param {number} options.miot_actions.reset_side_brush.siid
     * @param {number} options.miot_actions.reset_side_brush.aiid
     *
     * @param {object} options.miot_actions.reset_filter
     * @param {number} options.miot_actions.reset_filter.siid
     * @param {number} options.miot_actions.reset_filter.aiid
     *
     * @param {object} [options.miot_actions.reset_sensor]
     * @param {number} options.miot_actions.reset_sensor.siid
     * @param {number} options.miot_actions.reset_sensor.aiid
     *
     * @param {object} [options.miot_actions.reset_mop]
     * @param {number} options.miot_actions.reset_mop.siid
     * @param {number} options.miot_actions.reset_mop.aiid
     * 
     * @param {object} [options.miot_actions.reset_secondary_filter]
     * @param {number} options.miot_actions.reset_secondary_filter.siid
     * @param {number} options.miot_actions.reset_secondary_filter.aiid
     * 
     * @param {object} [options.miot_actions.reset_detergent]
     * @param {number} options.miot_actions.reset_detergent.siid
     * @param {number} options.miot_actions.reset_detergent.aiid
     * 
     * @param {object} [options.miot_actions.reset_wheel]
     * @param {number} options.miot_actions.reset_wheel.siid
     * @param {number} options.miot_actions.reset_wheel.aiid
     *
     * @param {object} [options.miot_actions.reset_roller_mop_fluffer]
     * @param {number} options.miot_actions.reset_roller_mop_fluffer.siid
     * @param {number} options.miot_actions.reset_roller_mop_fluffer.aiid
     * @param {object} [options.miot_actions.reset_silver_ion]
     * @param {object} [options.miot_actions.reset_deodorant]
     * @param {object} [options.miot_actions.reset_scale_inhibitor]
     * @param {object} [options.miot_actions.reset_wash_tray]
     * @param {object} [options.miot_actions.reset_dirty_water_tank]
     *
     *
     * @param {object} options.miot_properties
     * @param {object} options.miot_properties.main_brush
     * @param {number} options.miot_properties.main_brush.siid
     * @param {number} options.miot_properties.main_brush.piid
     *
     * @param {object} options.miot_properties.side_brush
     * @param {number} options.miot_properties.side_brush.siid
     * @param {number} options.miot_properties.side_brush.piid
     *
     * @param {object} options.miot_properties.filter
     * @param {number} options.miot_properties.filter.siid
     * @param {number} options.miot_properties.filter.piid
     *
     * @param {object} [options.miot_properties.sensor]
     * @param {number} options.miot_properties.sensor.siid
     * @param {number} options.miot_properties.sensor.piid
     *
     * @param {object} [options.miot_properties.mop]
     * @param {number} options.miot_properties.mop.siid
     * @param {number} options.miot_properties.mop.piid
     * 
     * @param {object} [options.miot_properties.secondary_filter]
     * @param {number} options.miot_properties.secondary_filter.siid
     * @param {number} options.miot_properties.secondary_filter.piid
     * 
     * @param {object} [options.miot_properties.detergent]
     * @param {number} options.miot_properties.detergent.siid
     * @param {number} options.miot_properties.detergent.piid
     * 
     * @param {object} [options.miot_properties.wheel]
     * @param {number} options.miot_properties.wheel.siid
     * @param {number} options.miot_properties.wheel.piid
     *
     * @param {object} [options.miot_properties.roller_mop_fluffer]
     * @param {number} options.miot_properties.roller_mop_fluffer.siid
     * @param {number} options.miot_properties.roller_mop_fluffer.piid
     *
     * Dock consumables. Each key of DOCK_CONSUMABLES can be given in miot_properties and in miot_actions.
     * @param {object} [options.miot_properties.silver_ion]
     * @param {object} [options.miot_properties.deodorant]
     * @param {object} [options.miot_properties.scale_inhibitor]
     * @param {object} [options.miot_properties.wash_tray]
     * @param {object} [options.miot_properties.dirty_water_tank]
     */
    constructor(options) {
        super(options);

        this.miot_actions = options.miot_actions;
        this.miot_properties = options.miot_properties;
    }


    /**
     * This function polls the current consumables
     *
     * @abstract
     * @returns {Promise<Array<import("../../../entities/core/ValetudoConsumable")>>}
     */
    async getConsumables() {
        const props = [
            this.miot_properties.main_brush,
            this.miot_properties.side_brush,
            this.miot_properties.filter
        ];

        if (this.miot_properties.sensor) {
            props.push(this.miot_properties.sensor);
        }

        if (this.miot_properties.mop) {
            props.push(this.miot_properties.mop);
        }

        if (this.miot_properties.secondary_filter) {
            props.push(this.miot_properties.secondary_filter);
        }

        if (this.miot_properties.detergent) {
            props.push(this.miot_properties.detergent);
        }

        if (this.miot_properties.wheel) {
            props.push(this.miot_properties.wheel);
        }

        if (this.miot_properties.roller_mop_fluffer) {
            props.push(this.miot_properties.roller_mop_fluffer);
        }

        Object.keys(DOCK_CONSUMABLES).forEach(key => {
            if (this.miot_properties[key]) {
                props.push(this.miot_properties[key]);
            }
        });

        let response;
        try {
            response = await this.robot.miotHelper.readProperties(props);
        } catch (e) {
            return [];
        }

        const filteredResponse = response.filter(elem => {
            return elem?.code === 0;
        })
            .map(elem => {
                return this.parseConsumablesMessage(elem);
            })
            .filter(elem => {
                return elem instanceof ValetudoConsumable;
            });

        this.raiseEventIfRequired(filteredResponse);

        return filteredResponse;
    }

    /**
     * @param {string} type
     * @param {string} [subType]
     * @returns {Promise<void>}
     */
    async resetConsumable(type, subType) {
        let payload;

        switch (type) {
            case ValetudoConsumable.TYPE.BRUSH:
                switch (subType) {
                    case ValetudoConsumable.SUB_TYPE.MAIN:
                        payload = this.miot_actions.reset_main_brush;
                        break;
                    case ValetudoConsumable.SUB_TYPE.SIDE_RIGHT:
                        payload = this.miot_actions.reset_side_brush;
                        break;
                    case ValetudoConsumable.SUB_TYPE.SECONDARY:
                        if (this.miot_actions.reset_roller_mop_fluffer) {
                            payload = this.miot_actions.reset_roller_mop_fluffer;
                        }
                        break;
                }
                break;
            case ValetudoConsumable.TYPE.FILTER:
                switch (subType) {
                    case ValetudoConsumable.SUB_TYPE.MAIN:
                        payload = this.miot_actions.reset_filter;
                        break;
                    case ValetudoConsumable.SUB_TYPE.SECONDARY:
                        payload = this.miot_actions.reset_secondary_filter;
                        break;
                }
                break;
            case ValetudoConsumable.TYPE.CLEANING:
                switch (subType) {
                    case ValetudoConsumable.SUB_TYPE.SENSOR:
                        if (this.miot_actions.reset_sensor) {
                            payload = this.miot_actions.reset_sensor;
                        }
                        break;
                    case ValetudoConsumable.SUB_TYPE.WHEEL:
                        if (this.miot_actions.reset_wheel) {
                            payload = this.miot_actions.reset_wheel;
                        }
                        break;

                }
                break;
            case ValetudoConsumable.TYPE.MOP:
                if (this.miot_actions.reset_mop) {
                    switch (subType) {
                        case ValetudoConsumable.SUB_TYPE.ALL:
                            payload = this.miot_actions.reset_mop;
                            break;
                    }
                }
                break;
            case ValetudoConsumable.TYPE.DETERGENT:
                if (this.miot_actions.reset_detergent) {
                    switch (subType) {
                        case ValetudoConsumable.SUB_TYPE.DOCK:
                            payload = this.miot_actions.reset_detergent;
                            break;
                    }
                }
                break;
        }

        if (!payload) {
            const dockConsumableKey = Object.keys(DOCK_CONSUMABLES).find(key => {
                return DOCK_CONSUMABLES[key].type === type && DOCK_CONSUMABLES[key].subType === subType;
            });

            if (dockConsumableKey !== undefined) {
                payload = this.miot_actions[`reset_${dockConsumableKey}`];
            }
        }

        if (payload) {
            await this.robot.miotHelper.executeAction(payload.siid, payload.aiid);

            this.markEventsAsProcessed(type, subType);
        } else {
            throw new Error("No such consumable");
        }
    }


    parseConsumablesMessage(msg) {
        let consumable;

        const dockConsumableKey = Object.keys(DOCK_CONSUMABLES).find(key => {
            const prop = this.miot_properties[key];

            return prop && prop.siid === msg.siid && prop.piid === msg.piid;
        });

        if (dockConsumableKey !== undefined) {
            return this.parseDockConsumable(DOCK_CONSUMABLES[dockConsumableKey], msg.value);
        }

        switch (msg.siid) {
            case this.miot_properties.main_brush.siid: {
                switch (msg.piid) {
                    case this.miot_properties.main_brush.piid:
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.BRUSH,
                            subType: ValetudoConsumable.SUB_TYPE.MAIN,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                        break;
                }
                break;
            }
            case this.miot_properties.side_brush.siid: {
                switch (msg.piid) {
                    case this.miot_properties.side_brush.piid:
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.BRUSH,
                            subType: ValetudoConsumable.SUB_TYPE.SIDE_RIGHT,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                        break;
                }
                break;
            }
            case this.miot_properties.filter.siid: {
                switch (msg.piid) {
                    case this.miot_properties.filter.piid:
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.FILTER,
                            subType: ValetudoConsumable.SUB_TYPE.MAIN,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                        break;
                }
                break;
            }

            default:
                if (
                    this.miot_properties.sensor &&
                    msg.siid === this.miot_properties.sensor.siid
                ) {
                    if (msg.piid === this.miot_properties.sensor.piid) {
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.CLEANING,
                            subType: ValetudoConsumable.SUB_TYPE.SENSOR,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                    }
                } else if (
                    this.miot_properties.mop &&
                    msg.siid === this.miot_properties.mop.siid
                ) {
                    if (msg.piid === this.miot_properties.mop.piid) {
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.MOP,
                            subType: ValetudoConsumable.SUB_TYPE.ALL,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                    }
                } else if (
                    this.miot_properties.secondary_filter &&
                    msg.siid === this.miot_properties.secondary_filter.siid
                ) {
                    if (msg.piid === this.miot_properties.secondary_filter.piid) {
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.FILTER,
                            subType: ValetudoConsumable.SUB_TYPE.SECONDARY,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                    }
                } else if (
                    this.miot_properties.detergent &&
                    msg.siid === this.miot_properties.detergent.siid
                ) {
                    if (msg.piid === this.miot_properties.detergent.piid) {
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.DETERGENT,
                            subType: ValetudoConsumable.SUB_TYPE.DOCK,
                            remaining: {
                                value: Math.max(0, msg.value),
                                unit: ValetudoConsumable.UNITS.PERCENT
                            }
                        });
                    }
                } else if (
                    this.miot_properties.wheel &&
                    msg.siid === this.miot_properties.wheel.siid
                ) {
                    if (msg.piid === this.miot_properties.wheel.piid) {
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.CLEANING,
                            subType: ValetudoConsumable.SUB_TYPE.WHEEL,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                    }
                } else if (
                    this.miot_properties.roller_mop_fluffer &&
                    msg.siid === this.miot_properties.roller_mop_fluffer.siid
                ) {
                    if (msg.piid === this.miot_properties.roller_mop_fluffer.piid) {
                        consumable = new ValetudoConsumable({
                            type: ValetudoConsumable.TYPE.BRUSH,
                            subType: ValetudoConsumable.SUB_TYPE.SECONDARY,
                            remaining: {
                                value: Math.round(Math.max(0, msg.value * 60)),
                                unit: ValetudoConsumable.UNITS.MINUTES
                            }
                        });
                    }
                }
        }

        return consumable;
    }

    /**
     * @private
     * @param {DockConsumableMeta} meta
     * @param {number} value
     * @returns {ValetudoConsumable|undefined}
     */
    parseDockConsumable(meta, value) {
        // The firmware returns -2 when the part is not installed
        if (typeof value !== "number" || value < 0) {
            return undefined;
        }

        return new ValetudoConsumable({
            type: meta.type,
            subType: meta.subType,
            remaining: {
                value: Math.round(value * meta.minutesPerUnit),
                unit: ValetudoConsumable.UNITS.MINUTES
            }
        });
    }

    getProperties() {
        /** @type Array<ConsumableMonitoringCapability.ConsumableMeta> **/
        const availableConsumables = [
            {
                type: ValetudoConsumable.TYPE.BRUSH,
                subType: ValetudoConsumable.SUB_TYPE.MAIN,
                unit: ValetudoConsumable.UNITS.MINUTES,
                maxValue: 300 * 60
            },
            {
                type: ValetudoConsumable.TYPE.BRUSH,
                subType: ValetudoConsumable.SUB_TYPE.SIDE_RIGHT,
                unit: ValetudoConsumable.UNITS.MINUTES,
                maxValue: 200 * 60
            },
            {
                type: ValetudoConsumable.TYPE.FILTER,
                subType: ValetudoConsumable.SUB_TYPE.MAIN,
                unit: ValetudoConsumable.UNITS.MINUTES,
                maxValue: 150 * 60
            }
        ];

        if (this.miot_properties.sensor) {
            availableConsumables.push(
                {
                    type: ValetudoConsumable.TYPE.CLEANING,
                    subType: ValetudoConsumable.SUB_TYPE.SENSOR,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: 30 * 60
                }
            );
        }

        if (this.miot_properties.mop) {
            availableConsumables.push(
                {
                    type: ValetudoConsumable.TYPE.MOP,
                    subType: ValetudoConsumable.SUB_TYPE.ALL,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: 80 * 60
                }
            );
        }

        if (this.miot_properties.secondary_filter) {
            availableConsumables.push(
                {
                    type: ValetudoConsumable.TYPE.FILTER,
                    subType: ValetudoConsumable.SUB_TYPE.SECONDARY,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: 300 * 60
                }
            );
        }

        if (this.miot_properties.detergent) {
            availableConsumables.push(
                {
                    type: ValetudoConsumable.TYPE.DETERGENT,
                    subType: ValetudoConsumable.SUB_TYPE.DOCK,
                    unit: ValetudoConsumable.UNITS.PERCENT
                }
            );
        }

        if (this.miot_properties.wheel) {
            availableConsumables.push(
                {
                    type: ValetudoConsumable.TYPE.CLEANING,
                    subType: ValetudoConsumable.SUB_TYPE.WHEEL,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: 30 * 60
                }
            );
        }

        if (this.miot_properties.roller_mop_fluffer) {
            availableConsumables.push(
                {
                    type: ValetudoConsumable.TYPE.BRUSH,
                    subType: ValetudoConsumable.SUB_TYPE.SECONDARY,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: 30 * 60
                }
            );
        }

        Object.keys(DOCK_CONSUMABLES).forEach(key => {
            if (this.miot_properties[key]) {
                availableConsumables.push({
                    type: DOCK_CONSUMABLES[key].type,
                    subType: DOCK_CONSUMABLES[key].subType,
                    unit: ValetudoConsumable.UNITS.MINUTES,
                    maxValue: DOCK_CONSUMABLES[key].maxValue
                });
            }
        });

        return {
            availableConsumables: availableConsumables
        };
    }
}

/**
 * @typedef {object} DockConsumableMeta
 * @property {string} type
 * @property {string} subType
 * @property {number} minutesPerUnit Minutes per unit of the raw value
 * @property {number} maxValue In minutes
 */

const DAY = 24 * 60;
const HOUR = 60;

/**
 * Units and lifetimes are from the consumable table of the Dreame X50 firmware 4.3.9_2199.
 * Silver ion, deodorant and scale inhibitor count calendar days. The two cleaning reminders count hours of use.
 *
 * @type {Object<string, DockConsumableMeta>}
 */
const DOCK_CONSUMABLES = Object.freeze({
    silver_ion: {
        type: ValetudoConsumable.TYPE.SILVER_ION,
        subType: ValetudoConsumable.SUB_TYPE.DOCK,
        minutesPerUnit: DAY,
        maxValue: 365 * DAY
    },
    deodorant: {
        type: ValetudoConsumable.TYPE.DEODORANT,
        subType: ValetudoConsumable.SUB_TYPE.DOCK,
        minutesPerUnit: DAY,
        maxValue: 180 * DAY
    },
    scale_inhibitor: {
        type: ValetudoConsumable.TYPE.SCALE_INHIBITOR,
        subType: ValetudoConsumable.SUB_TYPE.DOCK,
        minutesPerUnit: DAY,
        maxValue: 1095 * DAY
    },
    wash_tray: {
        type: ValetudoConsumable.TYPE.CLEANING,
        subType: ValetudoConsumable.SUB_TYPE.WASH_TRAY,
        minutesPerUnit: HOUR,
        maxValue: 50 * HOUR
    },
    dirty_water_tank: {
        type: ValetudoConsumable.TYPE.CLEANING,
        subType: ValetudoConsumable.SUB_TYPE.DIRTY_WATER_TANK,
        minutesPerUnit: HOUR,
        maxValue: 110 * HOUR
    }
});

module.exports = DreameConsumableMonitoringCapability;
