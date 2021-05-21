# homebridge-xap3c
Homebridge Accessory for Xiaomi Air Purifier 3C


# Example Configuration
Add this under the accessories of Homebridge or Hoobs.

```
{
    "accessory": "XiaomiAirPurifier3CAccessory",
    "name": "Bedroom Air Purifier",
    "ip": "AIR_PURIFIER_IP_ADDRESS",
    "token": "AIR_PURIFIER_TOKEN",
    "did": "AIR_PURIFIER_DID",
    "polling_interval": 60000,
    "breakpoints": [
        5,
        12,
        35,
        55
    ]
}
```
