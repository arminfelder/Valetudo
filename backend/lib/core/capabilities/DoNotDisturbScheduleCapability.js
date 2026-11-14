const Capability = require("./Capability");
const NotImplementedError = require("../NotImplementedError");

/**
 * Several do-not-disturb windows with days of the week.
 * Robots that also have a DoNotDisturbCapability keep that single window separate from this list.
 *
 * @template {import("../ValetudoRobot")} T
 * @extends Capability<T>
 */
class DoNotDisturbScheduleCapability extends Capability {
    /**
     * @abstract
     * @returns {Promise<Array<import("../../entities/core/ValetudoDNDWindow")>>}
     */
    async getWindows() {
        throw new NotImplementedError();
    }

    /**
     * Replaces all windows. Windows without an id are added, missing ones are removed.
     *
     * @abstract
     * @param {Array<import("../../entities/core/ValetudoDNDWindow")>} windows
     * @returns {Promise<void>}
     */
    async setWindows(windows) {
        throw new NotImplementedError();
    }

    /**
     * @returns {DoNotDisturbScheduleCapabilityProperties}
     */
    getProperties() {
        return {
            maxWindows: DoNotDisturbScheduleCapability.DEFAULT_MAX_WINDOWS
        };
    }

    getType() {
        return DoNotDisturbScheduleCapability.TYPE;
    }
}

DoNotDisturbScheduleCapability.TYPE = "DoNotDisturbScheduleCapability";
DoNotDisturbScheduleCapability.DEFAULT_MAX_WINDOWS = 10;

/**
 * @typedef {object} DoNotDisturbScheduleCapabilityProperties
 * @property {number} maxWindows
 */

module.exports = DoNotDisturbScheduleCapability;
