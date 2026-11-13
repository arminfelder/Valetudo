const DmiotCodec = require("./DmiotCodec");
const Logger = require("../Logger");
const MiioErrorResponseRobotFirmwareError = require("../miio/MiioErrorResponseRobotFirmwareError");
const MiioTimeoutError = require("../miio/MiioTimeoutError");
const net = require("net");

/*
 * A TCP server that takes the place of the dmiot daemon on newer dreame robots.
 * The robot firmware connects to it as a client.
 *
 * Provides the same interface as the cloud MiioSocket so that it can be used in its place.
 */
class DmiotSocket {
    /**
     * @param {object} options
     * @param {string} options.bindIP
     * @param {number=} options.port
     * @param {number=} options.timeout timeout in milliseconds to wait for a response
     * @param {(msg: any) => void} options.onIncomingRequestMessage
     * @param {() => void} options.onConnected
     */
    constructor(options) {
        this.timeout = options.timeout ?? 2000;
        this.onIncomingRequestMessage = options.onIncomingRequestMessage;
        this.onConnected = options.onConnected;
        this.name = "dmiot";

        this.nextId = 1;
        /**
         * The robot supplies the keys. A null prototype prevents matches with inherited property names.
         *
         * @type {Object.<string, {
         *          timeout_id?: NodeJS.Timeout,
         *          resolve: (result: any) => void,
         *          reject: (err: any) => void,
         *          method: string
         *      }>}
         */
        this.pendingRequests = Object.create(null);
        this.connected = false;
        /** @type {net.Socket | null} */
        this.connection = null;

        this.server = net.createServer(connection => {
            return this.handleConnection(connection);
        });

        this.port = options.port ?? DmiotSocket.PORT;
        this.bindIP = options.bindIP;
        this.listenRetryTimeout = undefined;

        this.server.on("error", (e) => {
            if (/** @type {Error & {code?: string}} */ (e).code === "EADDRINUSE") {
                Logger.error(`dmiot port ${this.port} is in use. The dmiot daemon must be stopped. Retrying in ${LISTEN_RETRY_INTERVAL / 1000}s`);

                this.listenRetryTimeout = setTimeout(() => {
                    this.listen();
                }, LISTEN_RETRY_INTERVAL);
            } else {
                Logger.error("DmiotSocket Error: ", e);
            }
        });

        this.server.on("listening", () => {
            Logger.info(`DmiotSocket listening on ${this.bindIP}:${this.port}`);
        });

        this.listen();
    }

    /**
     * @private
     */
    listen() {
        this.server.listen(this.port, this.bindIP);
    }

    /**
     * @private
     * @param {net.Socket} connection
     */
    handleConnection(connection) {
        // The robot reconnects after errors. The newest connection always wins.
        if (this.connection !== null) {
            Logger.info("New dmiot client connection. Closing the previous one.");
            this.connection.destroy();
        }

        Logger.info(`dmiot client connected from ${connection.remoteAddress}:${connection.remotePort}`);

        const codec = new DmiotCodec();
        this.connection = connection;

        connection.on("data", chunk => {
            codec.decode(chunk).forEach(msg => {
                this.handleIncomingMessage(msg);
            });
        });

        connection.on("close", () => {
            if (this.connection === connection) {
                Logger.info("dmiot client disconnected");

                this.connection = null;
                this.connected = false;
            }
        });

        connection.on("error", (e) => {
            Logger.warn("dmiot client connection error", e);
        });

        if (!this.connected) {
            this.connected = true;

            if (typeof this.onConnected === "function") {
                this.onConnected();
            }
        }
    }

    /**
     * @private
     * @param {any} msg
     */
    handleIncomingMessage(msg) {
        Logger.debug(`<<< ${this.name}:`, msg);

        if (msg["id"] && (msg["result"] !== undefined || msg["error"] !== undefined)) {
            const pendingRequest = this.pendingRequests[msg["id"]];

            if (pendingRequest) {
                clearTimeout(pendingRequest.timeout_id);

                if (msg["error"] !== undefined) {
                    if (msg["error"]?.message !== "user ack timeout") {
                        Logger.info("dmiot error response", msg);
                    } else {
                        Logger.trace("dmiot error response", msg);
                    }

                    pendingRequest.reject(
                        new MiioErrorResponseRobotFirmwareError(
                            msg["error"]?.message,
                            msg["error"]
                        )
                    );
                } else {
                    pendingRequest.resolve(msg["result"]);
                }

                delete this.pendingRequests[msg["id"]];
            } else {
                Logger.debug(`<< ${this.name}: ignoring response for non-pending request`, msg);
            }
        } else if (msg["error"]) {
            Logger.warn("unhandled dmiot error response", msg);
        } else if (typeof this.onIncomingRequestMessage === "function") {
            this.onIncomingRequestMessage(msg);
        }
    }

    /**
     * Used for both sending commands or responses.
     *
     * @param {object} msg JSON object to send to remote
     * @param {object} options
     * @param {number=} options.timeout timeout in milliseconds
     * @returns {Promise<object>}
     */
    sendMessage(msg, options = {}) {
        return new Promise((resolve, reject) => {
            this.assignId(msg);

            let packet;
            try {
                packet = DmiotCodec.encode(msg);
            } catch (e) {
                return reject(e);
            }

            const isResponse = msg["result"] !== undefined || msg["error"] !== undefined;

            if (!isResponse) {
                const msgId = msg["id"];

                this.pendingRequests[msgId] = {
                    resolve: resolve,
                    reject: reject,
                    method: msg["method"],
                    timeout_id: setTimeout(() => {
                        Logger.debug(`${this.name} request ${msgId} ${msg["method"]} timed out`);
                        delete this.pendingRequests[msgId];

                        reject(new MiioTimeoutError(msg));
                    }, options.timeout ?? this.timeout)
                };
            }

            if (this.connection === null) {
                Logger.debug(`>>> ${this.name}: not connected. Dropping`, msg);
            } else {
                Logger.debug(`>>> ${this.name}:`, msg);
                this.connection.write(packet);
            }

            if (isResponse) {
                resolve(undefined);
            }
        });
    }

    /**
     * @private
     * @param {object} msg
     */
    assignId(msg) {
        if (!msg["id"]) {
            if (this.nextId > MAX_INT32) {
                this.nextId = 1;
            }

            msg["id"] = this.nextId++;
        }
    }

    /**
     * Sends a message that the robot does not respond to
     *
     * @param {object} msg
     */
    sendNotification(msg) {
        this.assignId(msg);

        if (this.connection === null) {
            Logger.debug(`>>> ${this.name}: not connected. Dropping`, msg);

            return;
        }

        Logger.debug(`>>> ${this.name}:`, msg);
        this.connection.write(DmiotCodec.encode(msg));
    }

    /**
     * @returns {Promise<void>}
     */
    shutdown() {
        return new Promise((resolve) => {
            Logger.debug(this.name, "socket shutdown in progress...");

            clearTimeout(this.listenRetryTimeout);

            Object.values(this.pendingRequests).forEach(pendingRequest => {
                clearTimeout(pendingRequest.timeout_id);
            });
            this.pendingRequests = Object.create(null);

            this.connection?.destroy();

            this.server.close(() => {
                Logger.debug(this.name, "socket shutdown done");

                resolve();
            });
        });
    }
}

const MAX_INT32 = 0x7fffffff;
const LISTEN_RETRY_INTERVAL = 5000;

DmiotSocket.PORT = 64320;

module.exports = DmiotSocket;
