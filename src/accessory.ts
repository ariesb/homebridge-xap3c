import {
  AccessoryConfig,
  AccessoryPlugin,
  API,
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service
} from "homebridge";

const miio = require('miio');

let hap: HAP;

export = (api: API) => {
  hap = api.hap;
  api.registerAccessory("XiaomiAirPurifier3CAccessory", XiaomiAirPurifier3CAccessory);
};

interface DeviceConfig {
  did: string;
  token: string;
  ip: string;
}

interface DeviceInfo {
  model: string;
  firmware: string;
}

interface DeviceCharacteristics {
  power: boolean;
  mode: number;
  aqi: number;
  filterLifeRemaining: number;
  filterHoursUsed: number;
  buzzer: boolean;
  ledLevel: number;
  childLock: boolean;
  motorSpeed: number;
  favoriteRPM: number;
}

class AirPurifierDevice {
  private config: DeviceConfig;
  private log: Logging;
  private properties: any[] = [];
  private device: any;
  private deviceCharateristics: DeviceCharacteristics = {
    power: false,
    mode: 0,
    aqi: 0,
    filterLifeRemaining: 0,
    filterHoursUsed: 0,
    buzzer: false,
    ledLevel: 0,
    childLock: false,
    motorSpeed: 0,
    favoriteRPM: 0
  };
  private deviceInfo: DeviceInfo = {
    model: "zhimi.airpurifier.mb4",
    firmware: "UNKNOWN"
  };
  private callbacks: Function = () => { };

  constructor(config: DeviceConfig, log: Logging) {
    this.config = config;
    this.log = log;

    this.trackProperty(2, 1); // power
    this.trackProperty(2, 4); // mode
    this.trackProperty(3, 4); // aqi
    this.trackProperty(4, 1); // filter life remaining
    this.trackProperty(4, 3); // filter hours used
    this.trackProperty(6, 1); // buzzer
    this.trackProperty(8, 1); // LED
    this.trackProperty(9, 1); // motor speed
    this.trackProperty(9, 3); // favorite rpm

    this.connect();
  }

  getFirmware() {
    return this.deviceInfo.firmware || "0.1.0";
  }

  trackProperty(siid: number, piid: number) {
    this.properties.push({
      "did": this.config.did,
      "siid": siid,
      "piid": piid,
      "value": null
    });
  }

  onChange(callback: Function) {
    this.callbacks = callback;
  }

  private getProperty(props: any, siid: number, piid: number): any {
    let val = props.filter((p: any) => (p.siid === siid && p.piid === piid));
    return val ? val[0] : { value: undefined };
  }

  setDeviceCharateristics(props: any) {
    let oldPowerValue = this.deviceCharateristics.power;
    let oldAQIValue = this.deviceCharateristics.aqi;
    this.deviceCharateristics.power = this.getProperty(props, 2, 1).value;
    this.deviceCharateristics.aqi = this.getProperty(props, 3, 4).value;

    if (oldPowerValue != this.deviceCharateristics.power ||
      oldAQIValue != this.deviceCharateristics.aqi) this.callbacks();
  }

  getDeviceCharacteristics(): DeviceCharacteristics {
    return this.deviceCharateristics;
  }

  async updateProperties() {
    try {
      let props = await this.device.miioCall('get_properties', this.properties);
      this.setDeviceCharateristics(props);
    } catch (deviceError) {
      this.log.error("Device failure: ", deviceError.code);
    }
  }

  async powerSwitch(value: boolean) {
    try {
      await this.device
        .miioCall('set_properties', [{
          'did': this.config.did,
          'siid': 2,
          'piid': 1,
          'value': value
        }])
      this.updateProperties();
    } catch (deviceError) {
      this.log.error("Device powerSwitch failure: ", deviceError.code);
    }
  }

  async connect() {
    try {
      this.device = await miio.device({ address: this.config.ip, token: this.config.token });
      this.log(`Device ${this.config.did} is now connected.`);
      let info = await this.device.miioCall("miIO.info");
      this.log(`Device Firmware is ${info.fw_ver}.`);
      this.deviceInfo.firmware = info.fw_ver;
      await this.updateProperties();
    } catch (connectionError) {
      this.log.error("Device connection failure: ", connectionError.code);
      setTimeout(function (self) {
        self.connect();
      }, 30000, this);
    }
  }
}

class XiaomiAirPurifier3CAccessory implements AccessoryPlugin {

  private readonly log: Logging;
  private readonly name: string;
  private readonly breakpoints: number[];
  private device: AirPurifierDevice;

  private readonly airPurifierService: Service;
  private readonly airQualitySensorService: Service;
  private readonly informationService: Service;

  constructor(log: Logging, config: AccessoryConfig, api: API) {
    this.log = log;
    this.name = config.name;
    this.breakpoints = config.breakpoints;

    let deviceConfig: DeviceConfig = {
      did: config.did,
      token: config.token,
      ip: config.ip
    };
    this.device = new AirPurifierDevice(deviceConfig, log);
    this.device.onChange(this.onPropsChange.bind(this));

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Name, this.name)
      .setCharacteristic(hap.Characteristic.Manufacturer, "Xiaomi")
      .setCharacteristic(hap.Characteristic.Model, 'Mi Air Purifier 3C')
      .setCharacteristic(hap.Characteristic.SerialNumber, config.did)
      .setCharacteristic(hap.Characteristic.FirmwareRevision, this.device.getFirmware());

    this.airPurifierService = new hap.Service.AirPurifier(this.name);
    this.airPurifierService
      .getCharacteristic(hap.Characteristic.Active)
      .on(CharacteristicEventTypes.GET, this.getPower.bind(this))
      .on(CharacteristicEventTypes.SET, this.setPower.bind(this));
    this.airPurifierService
      .getCharacteristic(hap.Characteristic.CurrentAirPurifierState)
      .on(CharacteristicEventTypes.GET, this.getCurrentAirPurifierState.bind(this));

    this.airQualitySensorService = new hap.Service.AirQualitySensor(this.name);
    this.airQualitySensorService
      .getCharacteristic(hap.Characteristic.AirQuality)
      .on(CharacteristicEventTypes.GET, this.getAirQuality.bind(this));
    this.airQualitySensorService
      .getCharacteristic(hap.Characteristic.StatusActive)
      .on(CharacteristicEventTypes.GET, this.getPower.bind(this));

    setInterval(this.pollProperties.bind(this), 30000);

    log.info("Xiaomi Air Purifier 3C finished initializing!");
  }

  pollProperties() {
    try {
      this.log('Polling properties')
      this.device.updateProperties();
    } catch (e) {
      this.log(e);
    }
  }

  identify(): void {
    this.log("Identify!");
  }

  getServices(): Service[] {
    return [
      this.informationService,
      this.airPurifierService,
      this.airQualitySensorService
    ];
  }

  getPower(callback: CharacteristicGetCallback) {
    this.log('getPower: ' + (this.device.getDeviceCharacteristics().power ? "ON" : "OFF"));

    try {
      if (this.device.getDeviceCharacteristics().power == true) {
        return callback(null, hap.Characteristic.Active.ACTIVE);
      } else {
        return callback(null, hap.Characteristic.Active.INACTIVE);
      }
    } catch (e) {
      this.log('getPower Failed: ' + e);
      callback(e);
    }
  }

  setPower(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.log('setPower ' + value);
    try {
      this.device.powerSwitch(value === hap.Characteristic.Active.ACTIVE);
      callback();
    } catch (e) {
      this.log('setPower Failed: ' + e);
      callback(e);
    }
  }

  onPropsChange() {
    this.onPowerChange();
    this.onAirQualityChange();
    this.onCurrentAirPurifierStateChange();
    this.informationService.setCharacteristic(hap.Characteristic.FirmwareRevision, this.device.getFirmware());
  }

  onPowerChange() {
    this.log('onPowerChage');

    try {
      var powerState = this.device.getDeviceCharacteristics().power ? hap.Characteristic.Active.ACTIVE : hap.Characteristic.Active.INACTIVE;

      this.airPurifierService
        .getCharacteristic(hap.Characteristic.Active)
        .setValue(powerState, undefined, 'fromOutsideHomekit');

    } catch (e) {
      this.log('onPowerChage Failed: ' + e);
    }
  }

  onAirQualityChange() {
    this.log("onAirQualityChange");

    try {
      let aqi = this.device.getDeviceCharacteristics().aqi;
      let quality = this.getAirQualityCharacteristic(aqi);
      this.airQualitySensorService.setCharacteristic(hap.Characteristic.AirQuality, quality);
    } catch (e) {
      this.log('onAirQualityChange Failed: ' + e);
    }
  }

  private getAirQualityCharacteristic(aqi: number) {
    let quality = hap.Characteristic.AirQuality.UNKNOWN;
    if (aqi <= this.breakpoints[0]) { quality = hap.Characteristic.AirQuality.EXCELLENT; }
    else if (aqi <= this.breakpoints[1]) { quality = hap.Characteristic.AirQuality.GOOD; }
    else if (aqi <= this.breakpoints[2]) { quality = hap.Characteristic.AirQuality.FAIR; }
    else if (aqi <= this.breakpoints[3]) { quality = hap.Characteristic.AirQuality.INFERIOR; }
    else { quality = hap.Characteristic.AirQuality.POOR; }

    return quality;
  }

  getAirQuality(callback: CharacteristicGetCallback) {
    try {
      let aqi = this.device.getDeviceCharacteristics().aqi;
      this.log("getAirQuality: " + aqi);
      let quality = this.getAirQualityCharacteristic(aqi);
      return callback(null, quality);
    } catch (e) {
      this.log('getAirQuality Failed: ' + e);
      callback(e);
    }
  }

  getCurrentAirPurifierState(callback: CharacteristicGetCallback) {
    this.log('getCurrentAirPurifierState');
    try {
      var value = hap.Characteristic.CurrentAirPurifierState.INACTIVE;

      if (this.device.getDeviceCharacteristics().power == true) {
        value = (this.device.getDeviceCharacteristics().motorSpeed == 0) ? hap.Characteristic.CurrentAirPurifierState.IDLE : hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      }
      callback(null, value);
    } catch (e) {
      this.log('getCurrentAirPurifierState Failed: ' + e);
      callback(e);
    }
  }

  onCurrentAirPurifierStateChange() {
    this.log('onCurrentAirPurifierStateChange');

    try {
      var value = hap.Characteristic.CurrentAirPurifierState.INACTIVE;

      if (this.device.getDeviceCharacteristics().power == true) {
        value = (this.device.getDeviceCharacteristics().motorSpeed == 0) ? hap.Characteristic.CurrentAirPurifierState.IDLE : hap.Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
      }

      this.airPurifierService.setCharacteristic(hap.Characteristic.CurrentAirPurifierState, value);
  } catch(e) {
      this.log('onCurrentAirPurifierStateChange Failed: ' + e);
  }
}
}
