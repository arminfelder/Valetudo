const SerializableEntity = require("../SerializableEntity");

class ValetudoDNDWindow extends SerializableEntity {
    /**
     * A do-not-disturb window. All times are UTC.
     *
     * @param {object} options
     * @param {number} [options.id] Assigned by Valetudo if not set
     * @param {boolean} options.enabled
     *
     * @param {object} options.start
     * @param {number} options.start.hour
     * @param {number} options.start.minute
     *
     * @param {object} options.end
     * @param {number} options.end.hour
     * @param {number} options.end.minute
     *
     * @param {Array<number>} options.dow Days of the week, 0 = Sunday. An empty array means "once".
     *
     * @param {object} [options.metaData]
     *
     * @class
     */
    constructor(options) {
        super(options);

        this.id = options.id;
        this.enabled = options.enabled;
        this.start = options.start;
        this.end = options.end;
        this.dow = options.dow;
    }
}

module.exports = ValetudoDNDWindow;
