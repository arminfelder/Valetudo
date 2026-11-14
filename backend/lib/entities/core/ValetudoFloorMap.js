const SerializableEntity = require("../SerializableEntity");

class ValetudoFloorMap extends SerializableEntity {
    /**
     * One of the maps that a robot with multi-floor support has stored.
     *
     * @param {object} options
     * @param {number} options.id
     * @param {string} [options.name]
     * @param {boolean} options.active true for the map that the robot uses now
     * @param {Array<{id: string, name?: string}>} options.segments
     * @param {object} [options.metaData]
     *
     * @class
     */
    constructor(options) {
        super(options);

        this.id = options.id;
        this.name = options.name;
        this.active = options.active;
        this.segments = options.segments;
    }
}

module.exports = ValetudoFloorMap;
