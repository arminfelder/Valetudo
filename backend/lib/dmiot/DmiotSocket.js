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
        /** @type {Set<net.Socket>} */
        this.connections = new Set();

        this.server = net.createServer(connection => {
            return this.handleConnection(connection);
        });
        // The dmiot daemon also accepts up to 9 clients (e.g. ava and dmiot_cli) and sends all messages to all of them.
        this.server.maxConnections = MAX_CLIENTS;

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
        Logger.info(`dmiot client connected from ${connection.remoteAddress}:${connection.remotePort}`);

        const codec = new DmiotCodec();
        this.connections.add(connection);

        // The robot reads with one recv() of 4096 bytes and does not buffer partial data. Nagle could merge writes beyond that.
        connection.setNoDelay(true);

        connection.on("data", chunk => {
            codec.decode(chunk).forEach(msg => {
                this.handleIncomingMessage(msg);
            });
        });

        connection.on("close", () => {
            if (this.connections.delete(connection)) {
                Logger.info(`dmiot client disconnected. ${this.connections.size} client(s) remaining`);
            }

            if (this.connections.size === 0) {
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

        const isResponse = msg["result"] !== undefined || msg["error"] !== undefined;
        const pendingRequest = isResponse && msg["id"] !== undefined ? this.pendingRequests[msg["id"]] : undefined;

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
        } else if (typeof msg["method"] === "string") {
            // Some robot-originated messages carry both a method and a result (e.g. call.check)
            if (typeof this.onIncomingRequestMessage === "function") {
                this.onIncomingRequestMessage(msg);
            }
        } else if (msg["error"] !== undefined) {
            Logger.warn("unhandled dmiot error response", msg);
        } else {
            Logger.debug(`<< ${this.name}: ignoring response for non-pending request`, msg);
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

            this.write(msg, packet);

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

        this.write(msg, DmiotCodec.encode(msg));
    }

    /**
     * @private
     * @param {object} msg
     * @param {Buffer} packet
     */
    write(msg, packet) {
        if (this.connections.size === 0) {
            Logger.debug(`>>> ${this.name}: not connected. Dropping`, msg);

            return;
        }

        Logger.debug(`>>> ${this.name}:`, msg);
        this.connections.forEach(connection => {
            connection.write(packet);
        });
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

            this.connections.forEach(connection => {
                connection.destroy();
            });

            this.server.close(() => {
                Logger.debug(this.name, "socket shutdown done");

                resolve();
            });
        });
    }
}

const MAX_INT32 = 0x7fffffff;
const MAX_CLIENTS = 9;
const LISTEN_RETRY_INTERVAL = 5000;

DmiotSocket.PORT = 64320;

module.exports = DmiotSocket;
