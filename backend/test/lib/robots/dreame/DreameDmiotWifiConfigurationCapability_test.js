const assert = require("node:assert");
const os = require("node:os");
const path = require("node:path");
const { after, describe, it } = require("node:test");

process.env.VALETUDO_CONFIG_PATH = path.join(os.tmpdir(), `valetudo_dmiot_wifi_test_${process.pid}.json`);

const Configuration = require("../../../../lib/Configuration");
const DreameDmiotWifiConfigurationCapability = require("../../../../lib/robots/dreame/capabilities/DreameDmiotWifiConfigurationCapability");
const DreameX50UltraValetudoRobot = require("../../../../lib/robots/dreame/DreameX50UltraValetudoRobot");
const MiioWifiConfigurationCapability = require("../../../../lib/robots/common/miioCapabilities/MiioWifiConfigurationCapability");
const ValetudoEventStore = require("../../../../lib/ValetudoEventStore");
const ValetudoWifiConfiguration = require("../../../../lib/entities/core/ValetudoWifiConfiguration");
const ValetudoWifiStatus = require("../../../../lib/entities/core/ValetudoWifiStatus");

const robots = [];

/**
 * @param {any} RobotClass
 * @returns {{robot: any, sentCommands: Array<string>}}
 */
function createRobot(RobotClass) {
    const config = new Configuration();

    // Off-robot, the miio robots need the ids and secrets that they would otherwise read from the firmware
    config.set("robot", Object.assign({}, config.get("robot"), {
        implementationSpecificConfig: {
            deviceId: 123456789,
            cloudSecret: "0000000000000000",
            localSecret: "0000000000000000",
            dummycloudBindIp: "127.0.0.1"
        }
    }));

    const robot = new RobotClass({
        config: config,
        valetudoEventStore: new ValetudoEventStore()
    });
    const sentCommands = [];

    robot.sendCommand = async (method) => {
        sentCommands.push(method);

        return {};
    };
    robots.push(robot);

    return {robot: robot, sentCommands: sentCommands};
}

const wifiConfig = new ValetudoWifiConfiguration({
    ssid: "home",
    credentials: {
        type: ValetudoWifiConfiguration.CREDENTIALS_TYPE.WPA2_PSK,
        typeSpecificSettings: {
            password: "secret123"
        }
    },
    metaData: {}
});

describe("DreameDmiotWifiConfigurationCapability", () => {
    after(async () => {
        for (const robot of robots) {
            await robot.shutdown();
            await new Promise(resolve => {
                robot.fdsMockServer.close(resolve);
            });
        }
    });

    it("is used by the X50 and refuses to set a Wi-Fi configuration without sending miIO.config_router", async () => {
        const {robot, sentCommands} = createRobot(DreameX50UltraValetudoRobot);
        const capability = robot.capabilities.WifiConfigurationCapability;

        assert.ok(capability instanceof DreameDmiotWifiConfigurationCapability);
        assert.strictEqual(capability instanceof MiioWifiConfigurationCapability, false);

        await assert.rejects(
            capability.setWifiConfiguration(wifiConfig),
            {message: DreameDmiotWifiConfigurationCapability.UNSUPPORTED_MESSAGE}
        );
        assert.deepStrictEqual(sentCommands, []);
    });

    it("keeps the Linux Wi-Fi status parsing", () => {
        const {robot} = createRobot(DreameX50UltraValetudoRobot);
        const status = robot.capabilities.WifiConfigurationCapability.parseIwStdout(
            "Connected to 01:23:45:67:89:ab (on wlan0)\n\tSSID: home\n\tsignal: -55 dBm\n\ttx bitrate: 72.2 MBit/s\n"
        );

        assert.strictEqual(status.state, ValetudoWifiStatus.STATE.CONNECTED);
        assert.strictEqual(status.details.ssid, "home");
        assert.strictEqual(status.details.signal, -55);
    });
});
