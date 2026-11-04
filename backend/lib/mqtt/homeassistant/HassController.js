const HassAnchor = require("./HassAnchor");
const HomieCommonAttributes = require("../homie/HomieCommonAttributes");
const Logger = require("../../Logger");
const MqttCommonAttributes = require("../MqttCommonAttributes");
const Tools = require("../../utils/Tools");

/**
 * This class is the main controller for all Hass components. Components are preferentially registered to the MQTT
 * handle that they are related to, and recycle the handle topics or the values using HassAnchors.
 *
 * Non-compliant components that need a special implementation can be registered here in the constructor using
 * .registerNonCompliantComponent(). However, this should be avoided whenever possible.
 *
 * All components, regardless of where they are registered, must never talk to the main MqttController and they will
 * always talk to this controller.
 * This controller handles publication of autodiscovery topics and (optionally) topic data that can't be handled by
 * mqtt handles.
 *
 * Autodiscovery uses the Home Assistant device-based discovery. All components are collected and published
 * together as one retained message on a single device discovery topic.
 *
 * Note that subscription is currently unimplemented for Hass. It can be easily added in a similar way to the main
 * MqttController if there's an actual need for it.
 */
class HassController {
    /**
     * @param {object} options
     * @param {import("../MqttController")} options.controller
     * @param {import("../../core/ValetudoRobot")} options.robot
     * @param {import("../../Configuration")} options.config
     * @param {string} options.friendlyName
     * @param {Map<string, string>} [options.previousComponents] componentId to platform of the previous HassController
     */
    constructor(options) {
        this.controller = options.controller;
        this.robot = options.robot;
        this.config = options.config;
        this.friendlyName = options.friendlyName;

        this.loadConfig();


        /** @package */
        this.debugAnchors = false;

        /**
         * Components so special they need their own completely separate implementation and management workflow.
         *
         * @private
         */
        this.nonCompliantComponents = [];

        /**
         * @private
         * @type {Map<string, {component: import("./components/HassComponent"), config: object}>}
         */
        this.discoveryComponents = new Map();

        /** @private */
        this.isConfigured = false;

        /** @private */
        this.publishDiscoveryTimeout = undefined;

        /**
         * A previous HassController of this process has already migrated the legacy topics
         *
         * @private
         */
        this.migrationDone = options.previousComponents !== undefined;

        /**
         * componentId to platform of all components in the last published device discovery
         *
         * @private
         * @type {Map<string, string>}
         */
        this.publishedComponents = new Map(options.previousComponents ?? []);
    }

    /**
     * @private
     */
    loadConfig() {
        const debugConfig = this.config.get("debug");

        this.topicPrefix = this.controller.currentConfig.customizations.topicPrefix;
        this.identifier = this.controller.currentConfig.identity.identifier;
        this.qos = this.controller.currentConfig.qos;

        this.objectId = `valetudo_${this.identifier.toLowerCase()}`;

        this.debugAnchors = debugConfig.debugHassAnchors ?? false;
    }

    /**
     * Get base topic for Home Assistant topics that can't be mapped to the handle-based topics
     *
     * @return {string}
     */
    getBaseTopic() {
        return this.topicPrefix + "/" + this.identifier + "/hass";
    }

    /**
     * Returns the "device" value common to all autodiscovery topics.
     *
     * @public
     * @return {object}
     */
    getAutoconfDeviceBoilerplate() {
        return {
            manufacturer: "Valetudo",
            model: `${this.robot.getManufacturer()} ${this.robot.getModelName()}`,
            name: this.friendlyName,
            identifiers: [this.identifier],
            sw_version: Tools.GET_VALETUDO_VERSION(),
            configuration_url: `http://${Tools.GET_ZEROCONF_HOSTNAME()}`
        };
    }

    /**
     * Register non-compliant components that can't be managed by handles. Components managed by handles do not have to be
     * registered.
     *
     * @private
     * @param {import("./components/HassComponent")} component
     */
    registerNonCompliantComponent(component) {
        this.nonCompliantComponents.push(component);
    }

    /**
     * Configures all non-compliant components. This method is used by MqttController.
     *
     * @return {Promise<void>}
     */
    async configure() {
        for (const component of this.nonCompliantComponents) {
            await component.configure();
        }

        this.isConfigured = true;

        await this.publishDeviceDiscovery();
    }

    /**
     * Deconfigures all non-compliant components. This method is used by MqttController.
     *
     * @param {import("../MqttController").DeconfigureOptions} [options]
     * @return {Promise<void>}
     */
    async deconfigure(options) {
        this.isConfigured = false;
        clearTimeout(this.publishDiscoveryTimeout);
        this.publishDiscoveryTimeout = undefined;

        for (const component of this.nonCompliantComponents) {
            await component.deconfigure(options);
        }

        this.discoveryComponents.clear();
    }

    /**
     * @public
     * @return {Map<string, string>} componentId to platform
     */
    getPublishedComponents() {
        return new Map(this.publishedComponents);
    }

    /**
     * @public
     * @return {string}
     */
    getDeviceDiscoveryTopic() {
        return "homeassistant/device/" + this.objectId + "/config";
    }

    /**
     * Remove the device and all its components from Home Assistant.
     *
     * @return {Promise<void>}
     */
    async removeDevice() {
        clearTimeout(this.publishDiscoveryTimeout);
        this.publishDiscoveryTimeout = undefined;
        this.publishedComponents.clear();

        await this.controller.publishHass(
            this.getDeviceDiscoveryTopic(),
            "",
            {qos: MqttCommonAttributes.QOS.AT_LEAST_ONCE, retain: true}
        );
    }

    /**
     * @private
     * @param {Array<string>} removedComponentIds
     * @return {object|null}
     */
    buildDeviceDiscoveryPayload(removedComponentIds) {
        const components = {};

        for (const [componentId, entry] of this.discoveryComponents) {
            components[componentId] = entry.config;
        }

        // Home Assistant removes a component only if it receives the component with nothing but its platform
        for (const componentId of removedComponentIds) {
            components[componentId] = {platform: this.publishedComponents.get(componentId)};
        }

        return this.controller.hassAnchorProvider.resolveTopicReferences({
            device: this.getAutoconfDeviceBoilerplate(),
            origin: {
                name: "Valetudo",
                sw_version: Tools.GET_VALETUDO_VERSION(),
                support_url: "https://valetudo.cloud"
            },
            availability_topic: this.controller.hassAnchorProvider.getTopicReference(HassAnchor.REFERENCE.AVAILABILITY),
            payload_available: HomieCommonAttributes.STATE.READY,
            // MqttController will try to send "lost" at least once before cleanly disconnecting
            payload_not_available: HomieCommonAttributes.STATE.LOST,
            qos: this.qos,
            components: components
        });
    }

    /**
     * @private
     * @return {Promise<void>}
     */
    async publishDeviceDiscovery() {
        clearTimeout(this.publishDiscoveryTimeout);
        this.publishDiscoveryTimeout = undefined;

        if (!this.isConfigured || this.discoveryComponents.size === 0) {
            return;
        }

        const removedComponentIds = [...this.publishedComponents.keys()].filter(componentId => {
            return !this.discoveryComponents.has(componentId);
        });
        const payload = this.buildDeviceDiscoveryPayload([]);

        if (payload === null) {
            Logger.warn("Unable to publish Home Assistant device discovery due to unresolved topic references");
            return;
        }

        // BEGIN migration code to be removed with a later version
        // Home Assistant keeps entity IDs only if migrate_discovery is sent to the old topics before the device payload.
        const migrate = !this.migrationDone;
        const legacyTopics = [...this.discoveryComponents.values()].map(entry => {
            return entry.component.getAutoconfTopic();
        });

        if (migrate) {
            for (const topic of legacyTopics) {
                await this.controller.publishHass(
                    topic,
                    JSON.stringify({migrate_discovery: true}),
                    {qos: MqttCommonAttributes.QOS.AT_LEAST_ONCE, retain: true}
                );
            }
        }
        // END migration code to be removed with a later version

        if (removedComponentIds.length > 0) {
            await this.controller.publishHass(
                this.getDeviceDiscoveryTopic(),
                JSON.stringify(this.buildDeviceDiscoveryPayload(removedComponentIds)),
                {qos: MqttCommonAttributes.QOS.AT_LEAST_ONCE, retain: true}
            );
        }

        await this.controller.publishHass(
            this.getDeviceDiscoveryTopic(),
            JSON.stringify(payload),
            {qos: MqttCommonAttributes.QOS.AT_LEAST_ONCE, retain: true}
        );

        this.publishedComponents = new Map([...this.discoveryComponents].map(([componentId, entry]) => {
            return [componentId, entry.component.componentType];
        }));

        // BEGIN migration code to be removed with a later version
        if (migrate) {
            for (const topic of legacyTopics) {
                await this.controller.publishHass(
                    topic,
                    "",
                    {qos: MqttCommonAttributes.QOS.AT_LEAST_ONCE, retain: true}
                );
            }

            this.migrationDone = true;
        }
        // END migration code to be removed with a later version
    }

    /**
     * Publishes the device discovery soon, so that changes of several components are sent as one message.
     *
     * @private
     */
    scheduleDeviceDiscoveryPublish() {
        if (!this.isConfigured || this.publishDiscoveryTimeout !== undefined) {
            return;
        }

        this.publishDiscoveryTimeout = setTimeout(() => {
            this.publishDeviceDiscovery().catch(err => {
                Logger.warn("Error while publishing Home Assistant device discovery", err);
            });
        }, HassController.DISCOVERY_PUBLISH_DELAY);
    }


    /**
     * Helper function for components to subscribe to topics of their interest
     *
     * @param {import("./components/HassComponent")} component
     * @return {Promise<void>}
     */
    async subscribe(component) {
        await this.controller.subscribe(component);
    }

    /**
     * Helper function for components to unsubscribe from topics
     *
     * @param {import("./components/HassComponent")} component
     * @return {Promise<void>}
     */
    async unsubscribe(component) {
        await this.controller.unsubscribe(component);
    }

    /**
     * Refresh component's managed topics. This method is used by components internally, it shouldn't be called
     * externally.
     *
     * @package
     * @param {import("./components/HassComponent")} component
     * @param {object} topics
     * @return {Promise<void>}
     */
    async refresh(component, topics) {
        const base = component.getBaseTopic();

        for (const [topic, payload] of Object.entries(topics)) {
            await this.controller.publishHass(
                topic === "" ? base : base + "/" + topic,
                // @ts-ignore
                (payload instanceof String || payload instanceof Buffer) ? payload : JSON.stringify(payload),
                {qos: this.qos, retain: true}
            );
        }
    }

    /**
     * Refresh component's autoconf. This method is used by components internally, it shouldn't be called
     * externally.
     *
     * @package
     * @param {import("./components/HassComponent")} component
     * @param {object} payload
     * @return {Promise<void>}
     */
    async refreshAutoconf(component, payload) {
        if (!payload) {
            return;
        }

        this.discoveryComponents.set(component.componentId, {
            component: component,
            config: Object.assign({platform: component.componentType}, payload)
        });

        this.scheduleDeviceDiscoveryPublish();
    }
}

HassController.DISCOVERY_PUBLISH_DELAY = 250; // ms

module.exports = HassController;
