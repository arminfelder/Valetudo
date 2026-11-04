const DmiotSocket = require("./DmiotSocket");
const Logger = require("../Logger");

/*
 * Replaces the dmiot daemon (and with it, the dreame cloud) on dreame robots that do not ship a miio_client.
 * The firmware sends the same messages over this link as it does to the miio_client on older robots.
 */
class DmiotDummycloud {
    /**
     * @param {object} options
     * @param {string} options.bindIP "127.0.0.1" on the robot, "0.0.0.0" in development
     * @param {number} [options.port]
     * @param {() => void} options.onConnected
     * @param {(msg: any) => boolean} options.onIncomingCloudMessage
     */
    constructor(options) {
        this.onIncomingCloudMessage = options.onIncomingCloudMessage;

        /*
            Named like the property of the miio Dummycloud because the robot uses both in the same way
         */
        this.miioSocket = new DmiotSocket({
            bindIP: options.bindIP,
            port: options.port,
            onIncomingRequestMessage: this.handleIncomingCloudMessage.bind(this),
            onConnected: () => {
                // The dmiot daemon sends this after it connected to the cloud
                this.miioSocket.sendNotification({
                    method: "local.status",
                    params: "cloud_connected"
                });

                options.onConnected();
            }
        });
    }

    /**
     * @private
     * @param {any} msg
     */
    handleIncomingCloudMessage(msg) {
        switch (msg.method) {
            case "_otc.info":
                // Device announcement without a message id. It does not expect a response.
                return;
            case "local.query_time":
                this.sendLocalTime();
                return;
        }

        if (!this.onIncomingCloudMessage(msg)) {
            Logger.info("Unknown dmiot message received:", msg);
        }
    }

    /**
     * The robot does not want a response to local.query_time.
     * It expects a separate local.time message with the unix time in seconds.
     *
     * @private
     */
    sendLocalTime() {
        const now = Math.floor(Date.now() / 1000);

        // Do not set the robot clock from an unsynced system clock
        if (now < MIN_PLAUSIBLE_UNIX_TIME) {
            Logger.warn("System time is not synced. Not sending local.time");

            return;
        }

        this.miioSocket.sendNotification({
            method: "local.time",
            params: now
        });
    }

    /**
     * @returns {Promise<void>}
     */
    async shutdown() {
        await this.miioSocket.shutdown();
    }
}

const MIN_PLAUSIBLE_UNIX_TIME = 1704067200; // 2024-01-01T00:00:00Z

module.exports = DmiotDummycloud;
