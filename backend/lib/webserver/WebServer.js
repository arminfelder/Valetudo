const basicAuth = require("express-basic-auth");
const compression = require("compression");
const dynamicMiddleware = require("express-dynamic-middleware");
const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const swaggerUi = require("swagger-ui-express");
const swaggerValidation = require("openapi-validator-middleware");

const Logger = require("../Logger");

const notFoundPages = require("./res/404");

const KillswitchRouter = require("./KillswitchRouter");
const Middlewares = require("./middlewares");
const RobotRouter = require("./RobotRouter");
const ValetudoRouter = require("./ValetudoRouter");


const fs = require("fs");
const MQTTRouter = require("./MQTTRouter");
const NetworkAdvertisementManagerRouter = require("./NetworkAdvertisementManagerRouter");
const NTPClientRouter = require("./NTPClientRouter");
const SSDPRouter = require("./SSDPRouter");
const SystemRouter = require("./SystemRouter");
const TimerRouter = require("./TimerRouter");
const Tools = require("../utils/Tools");
const UpdaterRouter = require("./UpdaterRouter");
const ValetudoEventRouter = require("./ValetudoEventRouter");
const WebServerTLSCertificateProvider = require("./WebServerTLSCertificateProvider");

class WebServer {
    /**
     * @param {object} options
     * @param {import("../core/ValetudoRobot")} options.robot
     * @param {import("../mqtt/MqttController")} options.mqttController
     * @param {import("../NetworkAdvertisementManager")} options.networkAdvertisementManager
     * @param {import("../NTPClient")} options.ntpClient
     * @param {import("../updater/Updater")} options.updater
     * @param {import("../scheduler/Scheduler")} options.scheduler
     * @param {import("../ValetudoEventStore")} options.valetudoEventStore
     * @param {import("../Configuration")} options.config
     * @param {import("../PhoenixManager")} options.phoenixManager
     * @param {import("../utils/ValetudoHelper")} options.valetudoHelper
     */
    constructor(options) {
        const self = this;

        this.robot = options.robot;
        this.config = options.config;
        this.phoenixManager = options.phoenixManager;
        this.valetudoHelper = options.valetudoHelper;

        this.valetudoEventStore = options.valetudoEventStore;

        this.webserverConfig = this.config.get("webserver");

        this.port = this.webserverConfig.port;

        this.basicAuthInUse = false; //TODO: redo auth

        this.app = express();
        this.app.use(compression());
        this.app.use(express.json());

        this.app.disable("x-powered-by");

        this.app.use(Middlewares.CSPMiddleware);
        this.app.use(Middlewares.VersionMiddleware);
        this.app.use(Middlewares.ServerMiddleware);

        if (this.webserverConfig.blockExternalAccess) {
            this.app.use(Middlewares.ExternalAccessCheckMiddleware);
        }

        this.app.use(
            Middlewares.EggTermMiddleware.eggTermLimiter,
            Middlewares.EggTermMiddleware.eggTermHandler
        );

        // Intentionally bypasses auth
        this.app.use(
            "/_killswitch",
            new KillswitchRouter({robot: this.robot}).getRouter()
        );

        const authMiddleware = this.createAuthMiddleware();
        const dynamicAuth = dynamicMiddleware.create([]);
        this.app.use(dynamicAuth.handle());

        if (this.webserverConfig.basicAuth.enabled === true) {
            dynamicAuth.use(authMiddleware);
            this.basicAuthInUse = true;
        }

        this.config.onUpdate((key) => {
            if (key === "webserver") {
                this.webserverConfig = this.config.get("webserver");

                if (this.basicAuthInUse && !this.webserverConfig.basicAuth.enabled) {
                    dynamicAuth.unuse(authMiddleware);
                    this.basicAuthInUse = false;
                } else if (!this.basicAuthInUse && this.webserverConfig.basicAuth.enabled) {
                    dynamicAuth.use(authMiddleware);
                    this.basicAuthInUse = true;
                }
            }
        });

        this.loadApiSpec();
        this.validator = function superBasicValidationMiddleware(req, res, next) {
            // We can save a lot of code in our routers by always at least making sure that req.body exists
            // even if it is not being validated by the schema
            if (req.method === "PUT" || req.method === "POST") {
                if (Tools.IS_EMPTY_OBJECT_OR_UNDEFINED_OR_NULL(req.body)) {
                    res.sendStatus(400);
                } else {
                    next();
                }
            } else {
                next();
            }
        };

        if (this.openApiSpec) {
            this.app.use("/swagger/", swaggerUi.serve, swaggerUi.setup(this.openApiSpec, {
                customCss: ".swagger-ui .topbar { display: none }"
            }));

            swaggerValidation.init(this.openApiSpec);
            this.validator = swaggerValidation.validate;
        }

        this.robotRouter = new RobotRouter({robot: this.robot, validator: this.validator});
        this.valetudoRouter = new ValetudoRouter({config: this.config, robot: this.robot, validator: this.validator});

        this.app.use("/api/v2/robot/", this.robotRouter.getRouter());

        this.app.use("/api/v2/valetudo/", this.valetudoRouter.getRouter());

        this.app.use("/api/v2/mqtt/", new MQTTRouter({config: this.config, mqttController: options.mqttController, validator: this.validator}).getRouter());

        this.app.use("/api/v2/networkadvertisement/", new NetworkAdvertisementManagerRouter({config: this.config, networkAdvertisementManager: options.networkAdvertisementManager, validator: this.validator}).getRouter());

        this.app.use("/api/v2/ntpclient/", new NTPClientRouter({config: this.config, ntpClient: options.ntpClient, validator: this.validator}).getRouter());

        this.app.use("/api/v2/timers/", new TimerRouter({config: this.config, robot: this.robot, validator: this.validator, scheduler: options.scheduler}).getRouter());

        this.app.use("/api/v2/system/", new SystemRouter({phoenixManager: this.phoenixManager}).getRouter());

        this.app.use("/api/v2/events/", new ValetudoEventRouter({valetudoEventStore: this.valetudoEventStore, validator: this.validator}).getRouter());

        this.app.use("/api/v2/updater/", new UpdaterRouter({config: this.config, updater: options.updater, validator: this.validator}).getRouter());

        this.app.use("/_ssdp/", new SSDPRouter({config: this.config, robot: this.robot, valetudoHelper: this.valetudoHelper}).getRouter());

        this.app.use(express.static(path.join(__dirname, "../../..", "frontend/build")));


        this.robot.initModelSpecificWebserverRoutes(this.app);


        this.app.use((err, req, res, next) => {
            if (err instanceof swaggerValidation.InputValidationError) {
                Logger.warn(`Received "${req.method} "to "${req.originalUrl}" with invalid payload`, err.errors);
                res.status(400).json({message: "Request payload is invalid.", error: err.errors});
            } else {
                Logger.error("Unhandled WebServer Error", err);
                res.sendStatus(500);
            }
        });

        this.app.get("*splat", (req, res) => {
            res.status(404).send(Tools.GET_RANDOM_ARRAY_ELEMENT(Object.values(notFoundPages)));
        });

        /** @type {Array<import("http").Server>} */
        this.servers = [];

        const tlsCredentials = this.loadTLSCredentials();

        if (tlsCredentials) {
            let httpsPort = this.webserverConfig.https.port;
            const httpsServer = https.createServer(tlsCredentials, this.app);

            let httpsListening = false;

            httpsServer.on("error", (err) => {
                httpsListening = false;

                /*
                    The Midea dummycloud listens on port 443 of a loopback address.
                    Then, Linux refuses a listener on port 443 of all addresses.
                 */
                if (
                    /** @type {Error & {code?: string}} */ (err).code === "EADDRINUSE" &&
                    httpsPort !== WebServer.HTTPS_FALLBACK_PORT &&
                    self.port !== WebServer.HTTPS_FALLBACK_PORT
                ) {
                    Logger.warn(`HTTPS port ${httpsPort} is in use. Trying port ${WebServer.HTTPS_FALLBACK_PORT} instead.`);

                    httpsPort = WebServer.HTTPS_FALLBACK_PORT;
                    httpsServer.listen(httpsPort);

                    return;
                }

                Logger.error(`HTTPS Webserver failed on port ${httpsPort}. Serving plain HTTP on port ${self.port} instead.`, err);
            });

            httpsServer.on("listening", () => {
                httpsListening = true;
                Logger.info("HTTPS Webserver running on port", httpsPort);
            });

            httpsServer.listen(httpsPort);

            const redirectServer = http.createServer((req, res) => {
                if (httpsListening) {
                    this.handleHttpsRedirect(req, res, httpsPort);
                } else {
                    this.app(req, res);
                }
            });

            redirectServer.listen(this.port, function() {
                Logger.info("HTTP Webserver running on port", self.port);
            });

            this.servers.push(httpsServer, redirectServer);
        } else {
            const server = http.createServer(this.app);

            server.listen(this.port, function() {
                Logger.info("Webserver running on port", self.port);
            });

            this.servers.push(server);
        }
    }

    /**
     * @private
     * @returns {{cert: string, key: string} | null}
     */
    loadTLSCredentials() {
        const httpsConfig = this.webserverConfig.https;

        if (httpsConfig?.enabled !== true) {
            return null;
        }

        try {
            return WebServerTLSCertificateProvider.GET_CERTIFICATE({
                certPath: httpsConfig.certPath,
                keyPath: httpsConfig.keyPath,
                storageDir: path.dirname(this.config.location),
                hostnames: [
                    Tools.GET_ZEROCONF_HOSTNAME(),
                    "localhost",
                    ...WebServerTLSCertificateProvider.GET_LOCAL_IP_ADDRESSES()
                ]
            });
        } catch (e) {
            Logger.error("Failed to load HTTPS certificate. Falling back to plain HTTP.", e);

            return null;
        }
    }

    /**
     * @private
     * @param {import("http").IncomingMessage} req
     * @param {import("http").ServerResponse} res
     * @param {number} httpsPort
     */
    handleHttpsRedirect(req, res, httpsPort) {
        // SSDP clients fetch the device description over plain HTTP only.
        if (req.url?.startsWith("/_ssdp/")) {
            this.app(req, res);

            return;
        }

        const hostHeader = req.headers.host ?? "";
        const hostMatch = /^(\[[^\]]+\]|[^:]+)/.exec(hostHeader);

        if (!hostMatch) {
            res.statusCode = 400;
            res.end();

            return;
        }

        const portSuffix = httpsPort === 443 ? "" : `:${httpsPort}`;

        res.statusCode = 301;
        res.setHeader("Location", `https://${hostMatch[1]}${portSuffix}${req.url ?? "/"}`);
        res.end();
    }

    /**
     * @private
     * @returns {(req: any, res: any, next: any) => void}
     */
    createAuthMiddleware() {
        const basicAuthMiddleware = basicAuth({
            authorizer: (username, password) => {
                const basicAuthConf = this.config.get("webserver").basicAuth;

                const userMatches = basicAuth.safeCompare(username, basicAuthConf.username);
                const passwordMatches = basicAuth.safeCompare(password, basicAuthConf.password);

                return userMatches && passwordMatches;
            },
            challenge: true,
            unauthorizedResponse: (req) => {
                return req.auth ? "Invalid credentials" : "No credentials provided";
            }
        });

        return function authMiddleware(req, res, next) {
            try {
                basicAuthMiddleware(req, res, next);
            } catch (e) { /* basicAuth throws [ERR_HTTP_HEADERS_SENT] here if invalid credentials are sent */
                Logger.error("Error in BasicAuthMiddleware", e);
            }
        };
    }

    /**
     * Shutdown webserver
     *
     * @public
     * @returns {Promise<void>}
     */
    shutdown() {
        return new Promise((resolve, reject) => {
            Logger.debug("Webserver shutdown in progress...");
            this.robotRouter.shutdown();
            this.valetudoRouter.shutdown();

            Promise.all(this.servers.map(server => {
                return new Promise(closeResolve => {
                    server.close(() => {
                        closeResolve();
                    });
                });
            })).then(() => {
                Logger.debug("Webserver shutdown done");
                resolve();
            });
        });
    }

    /**
     * @private
     */
    loadApiSpec() {
        let spec;

        try {
            spec = JSON.parse(fs.readFileSync(path.join(__dirname, "../res/valetudo.openapi.schema.json")).toString());
        } catch (e) {
            Logger.warn("Failed to load OpenApi spec. Swagger endpoint and payload validation will be unavailable.", e.message);

            return;
        }


        const capabilityRoutePathRegex = /\/api\/v2\/robot\/capabilities\/(?<capabilityName>[A-Za-z]+)/;
        const supportedCapabilities = Object.keys(this.robot.capabilities);

        Object.keys(spec.paths).forEach(pathName => {
            const regexResult = capabilityRoutePathRegex.exec(pathName);
            const capabilityName = regexResult?.groups?.capabilityName;

            if (capabilityName !== undefined && !supportedCapabilities.includes(capabilityName)) {
                delete(spec.paths[pathName]);
            }
        });

        spec.tags = spec.tags.filter(tag => {
            return !(tag.name.endsWith("Capability") && !supportedCapabilities.includes(tag.name));
        });


        this.openApiSpec = spec;
    }
}

WebServer.HTTPS_FALLBACK_PORT = 8443;

module.exports = WebServer;
