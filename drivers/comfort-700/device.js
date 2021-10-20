"use strict";

const StripsZwaveDevice = require("../StripsZwaveDevice");

const i18n = {
  settings: {
    notificationTypeChangedSaveMessage: {
      en: "Notification type changed. In order to ensure continued proper operation, the Strips needs to be woken up manually.",
      nl: "Notificatietype gewijzigd. Voor correct functioneren moet de Strips handmatig wakker gemaakt worden.",
    },
  },
};
function luminanceReportParser(report) {
  const isLuminanceReport =
    report &&
    report.hasOwnProperty("Sensor Type") &&
    report.hasOwnProperty("Sensor Value (Parsed)") &&
    report["Sensor Type"] === "Luminance (version 1)";

  if (!isLuminanceReport) return null;

  const sensorValue = report["Sensor Value (Parsed)"];

  if (sensorValue < 0) {
    // Early firmwares of Strips Comfort mistakenly use a 16-bit integer to represent the luminance value.
    // Z-Wave only supports signed integers, but the value was intended as unsigned.
    // This should work around that issue, since a lux value can never be negative anyway.
    return 65536 + sensorValue;
  }

  return sensorValue;
}

class StripsMultiSensor extends StripsZwaveDevice {
  async onMeshInit() {
    this.registerSetting(
      "report_type",
      (value) => new Buffer([parseInt(value)])
    );
    this.registerSetting(
      "led_indication",
      (value) => new Buffer([value ? 1 : 0])
    );
    const settings = this.getSettings();
    this.registerTemperatureCapability();
    this.registerHeatAlarmCapability();

    await this.registerDynamicCapabilities(settings, true);
    this.registerBatteryCapabilities();
    this.updateMaintenanceActionRegistrations();
  }

  determineCapabilityIds(settings) {
    const capabilities = [];

    capabilities.push("measure_temperature", "alarm_heat");
    if (settings.maintenance_actions) {
      capabilities.push("button.reset_heat_alarm");
    }

    if (settings.device_type !== "drip") {
      capabilities.push("measure_luminance");
    }

    return capabilities.concat(super.determineCapabilityIds(settings));
  }
  // Changing capabilities here seems to crash the Homey App UI on most occasions.
  // async onSettings(oldSettings, newSettings, changedKeysArr) {
  //   let result = await super.onSettings(oldSettings, newSettings, changedKeysArr);
  //   await this.registerDynamicCapabilities(newSettings, false);
  //   if (changedKeysArr.includes('maintenance_actions')) {
  //     this.updateMaintenanceActionRegistrations();
  //   }
  //   return result;
  // }

  registerTemperatureCapability() {
    this.registerCapability("measure_temperature", "SENSOR_MULTILEVEL", {
      getOpts: {
        getOnOnline: true,
      },
    });
  }

  registerHeatAlarmCapability() {
    this.registerCapability("alarm_heat", "NOTIFICATION", {
      reportParser: (report) => {
        if (report["Notification Type"] === "Heat") {
          switch (report["Event"]) {
            case 2: // Overheat
            case 6: // Underheat
              return true;
            case 0: // Heat alarm OFF
              return false;
          }
        }

        return null;
      },
      getOpts: {
        getOnOnline: true,
      },
    });
  }

  registerLuminanceCapability() {
    this.registerCapability("measure_luminance", "SENSOR_MULTILEVEL", {
      reportParser: luminanceReportParser,
      getOpts: {
        getOnOnline: true,
      },
    });
  }

  registerHumidityCapability() {
    this.registerCapability("measure_humidity", "SENSOR_MULTILEVEL", {
      reportParser: (report) => {
        if (report["Sensor Type"] === "Moisture (v5)") {
          return report["Sensor Value (Parsed)"];
        }
        return null;
      },
      getOpts: {
        getOnOnline: true,
      },
    });
  }

  registerWaterAlarmCapability() {
    this.registerCapability("alarm_water", "NOTIFICATION", {
      getOpts: {
        getOnOnline: true,
      },
    });
  }

  async registerDynamicCapabilities(settings, initializing) {
    const addedCapabilities = await this.ensureCapabilitiesMatch(
      this.determineCapabilityIds(settings)
    );
    const capabilities = initializing
      ? this.getCapabilities()
      : addedCapabilities;

    if (capabilities.includes("measure_luminance")) {
      this.registerLuminanceCapability();
    }

    if (capabilities.includes("measure_humidity")) {
      this.registerHumidityCapability();
    }

    if (capabilities.includes("alarm_water")) {
      this.registerWaterAlarmCapability();
    }

    if (capabilities.includes("alarm_tamper")) {
      this.registerTamperAlarmCapability();
    }
  }

  updateMaintenanceActionRegistrations() {
    const maintenanceActions = {
      "button.reset_heat_alarm": () =>
        this.setCapabilityValue("alarm_heat", false),
      "button.reset_water_alarm": () =>
        this.setCapabilityValue("alarm_water", false),
      "button.reset_tamper_alarm": () =>
        this.setCapabilityValue("alarm_tamper", false),
    };

    this.registerMaintenanceActions(maintenanceActions);
  }
}

module.exports = StripsMultiSensor;
