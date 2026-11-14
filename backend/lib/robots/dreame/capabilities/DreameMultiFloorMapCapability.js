const fs = require("fs");

const DreameMapParser = require("../DreameMapParser");
const Logger = require("../../../Logger");
const MapLayer = require("../../../entities/map/MapLayer");
const MultiFloorMapCapability = require("../../../core/capabilities/MultiFloorMapCapability");
const RobotFirmwareError = require("../../../core/RobotFirmwareError");
const ValetudoFloorMap = require("../../../entities/core/ValetudoFloorMap");

/**
 * Protocol from Dreame X50 fw 4.3.9_2199 and Tasshack/dreame-vacuum. See the KG entity dreame-x50-multi-map.
 *
 * @extends MultiFloorMapCapability<import("../DreameValetudoRobot")>
 */
class DreameMultiFloorMapCapability extends MultiFloorMapCapability {
    /**
     * @param {object} options
     * @param {import("../DreameValetudoRobot")} options.robot
     *
     * @param {object} options.miot_actions
     * @param {object} options.miot_actions.map_edit
     * @param {number} options.miot_actions.map_edit.siid
     * @param {number} options.miot_actions.map_edit.aiid
     *
     * @param {object} options.miot_properties
     * @param {object} options.miot_properties.mapDetails
     * @param {number} options.miot_properties.mapDetails.piid
     * @param {object} options.miot_properties.actionResult
     * @param {number} options.miot_properties.actionResult.piid
     * @param {object} options.miot_properties.multiFloorEnabled
     * @param {number} options.miot_properties.multiFloorEnabled.siid
     * @param {number} options.miot_properties.multiFloorEnabled.piid
     *
     * @param {string} [options.mapListPath] Local copy of the map list on the robot
     */
    constructor(options) {
        super(options);

        this.miot_actions = options.miot_actions;
        this.miot_properties = options.miot_properties;
        this.mapListPath = options.mapListPath;

        /** @type {{key: string, maps: Array<ValetudoFloorMap>} | null} */
        this.parsedMapsCache = null;
    }

    /**
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        const res = await this.robot.miotHelper.readProperty(
            this.miot_properties.multiFloorEnabled.siid,
            this.miot_properties.multiFloorEnabled.piid
        );

        return res === 1;
    }

    /**
     * @param {boolean} enabled
     * @returns {Promise<void>}
     */
    async setEnabled(enabled) {
        await this.robot.miotHelper.writeProperty(
            this.miot_properties.multiFloorEnabled.siid,
            this.miot_properties.multiFloorEnabled.piid,
            enabled ? 1 : 0
        );
    }

    /**
     * @returns {Promise<Array<ValetudoFloorMap>>}
     */
    async getMaps() {
        const mapList = this.readMapList();
        // MQTT polls this. Parsing each stored map again would cost CPU time on the robot.
        const cacheKey = JSON.stringify(mapList);

        if (this.parsedMapsCache?.key === cacheKey) {
            return this.parsedMapsCache.maps;
        }

        const maps = [];

        for (const entry of mapList.mapstr) {
            try {
                maps.push(await DreameMultiFloorMapCapability.PARSE_MAP_LIST_ENTRY(entry, mapList.curr_id));
            } catch (e) {
                Logger.warn("Error while parsing a stored floor map", e);
            }
        }

        maps.sort((a, b) => {
            return a.id - b.id;
        });
        this.parsedMapsCache = {key: cacheKey, maps: maps};

        return maps;
    }

    /**
     * @param {number} id
     * @returns {Promise<void>}
     */
    async selectMap(id) {
        const map = await this.getStoredMap(id);

        if (map.active) {
            return;
        }

        await this.sendMapEdit({sm: {}, mapid: id});
    }

    /**
     * @param {number} id
     * @param {string} name
     * @returns {Promise<void>}
     */
    async renameMap(id, name) {
        if (name.length > this.getProperties().maxNameLength) {
            throw new Error(`The name must not be longer than ${this.getProperties().maxNameLength} characters`);
        }

        await this.getStoredMap(id);

        // Unlike segment names, map names are plain text. null removes the custom name.
        await this.sendMapEdit({nrism: {[id]: {name: name.length > 0 ? name : null}}});
    }

    /**
     * @param {number} id
     * @returns {Promise<void>}
     */
    async deleteMap(id) {
        const map = await this.getStoredMap(id);

        if (map.active) {
            throw new Error("The active map cannot be deleted here. Use the map reset instead.");
        }
        // With multi-floor maps disabled, the firmware deletes all stored maps on a delete (Tasshack)
        if (!(await this.isEnabled())) {
            throw new Error("Maps can only be deleted while multi-floor maps are enabled");
        }

        await this.sendMapEdit({cm: {}, mapid: id});
    }

    /**
     * @private
     * @param {number} id
     * @returns {Promise<ValetudoFloorMap>}
     */
    async getStoredMap(id) {
        const map = (await this.getMaps()).find(m => {
            return m.id === id;
        });

        if (!map) {
            throw new Error(`No stored map with id ${id}`);
        }

        return map;
    }

    /**
     * The robot uploads the same file when it changes. Valetudo keeps the last upload.
     *
     * @private
     * @returns {{mapstr: Array<any>, curr_id: number}}
     */
    readMapList() {
        let mapList;

        if (this.mapListPath && fs.existsSync(this.mapListPath)) {
            mapList = JSON.parse(fs.readFileSync(this.mapListPath, {encoding: "utf-8"}));
        } else {
            mapList = this.robot.lastUploadedMultiFloorMapList;
        }

        if (!mapList) {
            throw new Error("The robot has not reported its stored maps yet");
        }
        if (!DreameMultiFloorMapCapability.IS_MAP_LIST(mapList)) {
            throw new Error("Received an invalid list of stored maps");
        }

        return mapList;
    }

    /**
     * @private
     * @param {object} payload
     * @returns {Promise<void>}
     */
    async sendMapEdit(payload) {
        const res = await this.robot.sendCommand("action",
            {
                did: this.robot.deviceId,
                siid: this.miot_actions.map_edit.siid,
                aiid: this.miot_actions.map_edit.aiid,
                in: [
                    {
                        piid: this.miot_properties.mapDetails.piid,
                        value: JSON.stringify(payload)
                    }
                ]
            },
            {timeout: 5000}
        );

        if (
            res && res.siid === this.miot_actions.map_edit.siid &&
            res.aiid === this.miot_actions.map_edit.aiid &&
            Array.isArray(res.out) && res.out.length === 1 &&
            res.out[0].piid === this.miot_properties.actionResult.piid &&
            res.out[0].value !== 0
        ) {
            throw new RobotFirmwareError("Got error " + res.out[0].value + " while editing the stored maps.");
        }

        this.robot.pollMap();
    }

    /**
     * @param {any} data
     * @returns {boolean}
     */
    static IS_MAP_LIST(data) {
        return (
            typeof data === "object" && data !== null &&
            Array.isArray(data.mapstr) &&
            typeof data.curr_id === "number"
        );
    }

    /**
     * The list id of an entry is not the map id. The map id is in the header of the stored map.
     *
     * @param {{name?: string, map: string}} entry
     * @param {number} currentMapId
     * @returns {Promise<ValetudoFloorMap>}
     */
    static async PARSE_MAP_LIST_ENTRY(entry, currentMapId) {
        if (typeof entry?.map !== "string") {
            throw new Error("Stored map entry has no map data");
        }

        const buf = await DreameMapParser.PREPROCESS(entry.map);
        if (!buf) {
            throw new Error("Stored map data could not be decoded");
        }

        const header = DreameMapParser.PARSE_HEADER(buf);
        // Stored maps use the pixel format of the room information map (rism), not the one of the live map
        const map = await DreameMapParser.PARSE(buf, DreameMapParser.MAP_DATA_TYPES.RISM);

        const segments = (map?.layers ?? []).filter(layer => {
            return layer.type === MapLayer.TYPE.SEGMENT;
        }).map(layer => {
            return {
                id: layer.metaData.segmentId,
                name: layer.metaData.name
            };
        });

        return new ValetudoFloorMap({
            id: header.id,
            name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : undefined,
            active: header.id === currentMapId,
            segments: segments
        });
    }
}

module.exports = DreameMultiFloorMapCapability;
