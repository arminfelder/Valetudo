const Capability = require("./Capability");
const NotImplementedError = require("../NotImplementedError");

/**
 * Several stored maps, for example one per floor. The robot uses one of them at a time.
 *
 * @template {import("../ValetudoRobot")} T
 * @extends Capability<T>
 */
class MultiFloorMapCapability extends Capability {
    /**
     * @abstract
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        throw new NotImplementedError();
    }

    /**
     * When disabled, the robot uses one map only. It keeps the stored maps.
     *
     * @abstract
     * @param {boolean} enabled
     * @returns {Promise<void>}
     */
    async setEnabled(enabled) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @returns {Promise<Array<import("../../entities/core/ValetudoFloorMap")>>}
     */
    async getMaps() {
        throw new NotImplementedError();
    }

    /**
     * Makes the robot use this map. Move the robot and its dock to that floor first.
     *
     * @abstract
     * @param {number} id
     * @returns {Promise<void>}
     */
    async selectMap(id) {
        throw new NotImplementedError();
    }

    /**
     * @abstract
     * @param {number} id
     * @param {string} name An empty name removes the custom name
     * @returns {Promise<void>}
     */
    async renameMap(id, name) {
        throw new NotImplementedError();
    }

    /**
     * Deletes a stored map that is not active. Use the MapResetCapability for the active map.
     *
     * @abstract
     * @param {number} id
     * @returns {Promise<void>}
     */
    async deleteMap(id) {
        throw new NotImplementedError();
    }

    /**
     * @returns {MultiFloorMapCapabilityProperties}
     */
    getProperties() {
        return {
            maxNameLength: MultiFloorMapCapability.MAX_NAME_LENGTH
        };
    }

    getType() {
        return MultiFloorMapCapability.TYPE;
    }
}

MultiFloorMapCapability.TYPE = "MultiFloorMapCapability";
MultiFloorMapCapability.MAX_NAME_LENGTH = 32;

/**
 * @typedef {object} MultiFloorMapCapabilityProperties
 * @property {number} maxNameLength
 */

module.exports = MultiFloorMapCapability;
