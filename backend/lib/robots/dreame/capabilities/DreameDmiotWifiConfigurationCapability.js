const LinuxWifiConfigurationCapability = require("../../common/linuxCapabilities/LinuxWifiConfigurationCapability");

/**
 * Dreame robots with the dmiot firmware (e.g. the X50) do not ship a miio_client.
 * Thus, there is nothing that would handle miIO.config_router.
 *
 * @extends LinuxWifiConfigurationCapability<import("../DreameValetudoRobot")>
 */
class DreameDmiotWifiConfigurationCapability extends LinuxWifiConfigurationCapability {
    /**
     * @param {import("../../../entities/core/ValetudoWifiConfiguration")} wifiConfig
     * @returns {Promise<void>}
     */
    async setWifiConfiguration(wifiConfig) {
        throw new Error(DreameDmiotWifiConfigurationCapability.UNSUPPORTED_MESSAGE);
    }
}

DreameDmiotWifiConfigurationCapability.UNSUPPORTED_MESSAGE = "Changing the Wi-Fi configuration is not supported on this robot. Its firmware has no miio_client to apply it.";

module.exports = DreameDmiotWifiConfigurationCapability;
