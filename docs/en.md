# wM-Bus meters (wmbusmeters)

[wmbusmeters](https://github.com/wmbusmeters/wmbusmeters) reads **wireless
M-Bus radio meters** (868 MHz): water meters (Sensus iPERL, Diehl Izar and
Hydrus, Kamstrup Multical 21 and flowIQ, Itron, Apator, Techem…), heat meters
(Diehl Sharky, Kamstrup Multical 302 to 803…), gas and electricity meters,
heat cost allocators (Qundis Q caloric…). This integration reads what
wmbusmeters decodes and offers every meter in the **Discovery** tab of Gladys:
consumption index, flow, temperatures, status, and leak, burst, dry meter,
backflow, tamper and low battery alarms. Not affiliated with the wmbusmeters
project.

> **Development version (0.1).** Tested against the real wmbusmeters
> (official Docker image, 3.0.0 and development versions) replaying telegrams
> of its test suite, with a real Mosquitto broker, but not with a real radio
> receiver yet. Feedback is welcome on the GitHub repository.

## How it works

The radio receiver is **not plugged into Gladys**: integrations get no USB
access. wmbusmeters runs **next to the receiver** (on the Gladys machine in its
own container, on a Raspberry Pi closer to the meters, or as the Home
Assistant add-on), decodes the telegrams and, through its `shell=` line,
publishes each reading as JSON to your **MQTT broker**. The integration reads
that broker.

```
meters ))) receiver -> wmbusmeters -> mosquitto_pub -> MQTT broker -> integration -> Gladys
```

## What you get

| wmbusmeters field                                        | In Gladys                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| `total_m3`, `total_volume_m3`                            | volume (m³): the meter index                                   |
| `target_m3`                                              | volume at the billing date (end of the last month or year)     |
| `total_backward_m3`                                      | volume that flowed backwards                                   |
| `total_energy_consumption_kwh`, `total_kwh`              | energy index (kWh): heat and electricity meters                |
| `total_energy_production_kwh`                            | produced energy index (kWh)                                    |
| `current_power_consumption_kw`, `power_kw`               | power (converted to W)                                         |
| `volume_flow_m3h`, `flow_m3h`, `max_flow_m3h`            | flow, max flow (m³/h)                                          |
| `flow_temperature_c`, `return_temperature_c`             | flow and return temperatures (probes, out of the room average) |
| `current_consumption_hca`, `consumption_at_set_date_hca` | heat cost allocation units                                     |
| `current_temperature_c`, `current_relative_humidity_rh`  | temperature and humidity (room sensors)                        |
| `voltage_at_phase_1_v`…                                  | voltage per phase (electricity meters)                         |
| `battery_pct`, `remaining_battery_life_y`                | battery (%), battery life (years)                              |
| `rssi_dbm`                                               | signal (bars), when the receiver reports it                    |
| `status`, `current_status`                               | **Status** (text: `OK`, `LEAK`, `ERROR POWER_LOW`…)            |
| the status flags                                         | alarms: leak, burst, dry, backflow, tamper, battery low        |

One device = one meter number (the 8 digits printed on the meter), whatever
the driver or the name given in wmbusmeters. The histories (12 months,
intermediate billing dates) are left out: Gladys keeps the history of every
value itself.

The **alarms** a meter can raise are offered from its first reading, before
any alarm: those of its wmbusmeters driver, and those it declares when
wmbusmeters adds the details of the fields (`addtelegramdetails=first`, the
default of the "edge" Home Assistant add-on). An alarm never announced appears
the first time it is seen. Flags about the past (`PREV_LEAKAGE`,
`..._PREV_MONTH`…) are not alarms: they stay in the status text.

## 1. The receiver

- An **RTL-SDR dongle** (RTL-SDR Blog V3 or V4, Nooelec…, about 25 €): the
  simplest. The wmbusmeters Docker image includes `rtl_wmbus`, which listens
  to the T1 and C1 modes.
- Or a dedicated, more sensitive **wM-Bus module**: IMST iM871A / iU891A,
  Amber AMB8465 (Würth Metis), Radiocrafts RC1180, CUL.
- Put the antenna close to the meters (a water meter in a buried pit does not
  carry far). An RTL-SDR dongle already used by rtl_433 cannot serve
  wmbusmeters at the same time: one dongle per program.

## 2. Run wmbusmeters and make it publish to MQTT

wmbusmeters has no MQTT client of its own: its `shell=` line runs a command
for each reading, with the JSON of the reading in `$METER_JSON`.
`mosquitto_pub` (shipped in the official Docker image) sends it to the broker.

### With Docker

Create the configuration folder, for example `/opt/wmbusmeters`, with the file
`/opt/wmbusmeters/etc/wmbusmeters.conf` (replace the broker address, the user
and the password):

```ini
loglevel=normal
device=auto:t1
donotprobe=/dev/ttyAMA0
logtelegrams=false
format=json
ignoreduplicates=true
shell=/usr/bin/mosquitto_pub -h 192.168.1.10 -u USER -P PASSWORD -t wmbusmeters/$METER_ID -m "$METER_JSON"
```

then start the official image:

```bash
docker run -d --name wmbusmeters --restart unless-stopped --privileged \
  -v /etc/localtime:/etc/localtime:ro \
  -v /opt/wmbusmeters:/wmbusmeters_data \
  -v /dev/:/dev/ \
  wmbusmeters/wmbusmeters
```

- With a serial module (iM871A, AMB8465…) instead of an RTL-SDR dongle, the
  privileged mode is not needed: replace `--privileged -v /dev/:/dev/` with
  `--device /dev/ttyUSB0`, and `device=auto:t1` with the module, for example
  `device=/dev/ttyUSB0:im871a:c1,t1`.
- With an RTL-SDR dongle, `device=rtlwmbus` skips the probing of serial
  modules at startup.
- Without a broker user, remove `-u … -P …`.
- The broker can be the one of the Gladys MQTT integration (port 1883, the
  user and password of its configuration) or your own (Mosquitto…).

### Without Docker

wmbusmeters builds on a Raspberry Pi (`./configure && make && sudo make
install`, see its README) and then runs as a service: the same configuration
in `/etc/wmbusmeters.conf`, the meter files in `/etc/wmbusmeters.d/`,
`sudo apt install mosquitto-clients` for `mosquitto_pub`, then
`sudo systemctl restart wmbusmeters`.

### With the Home Assistant add-on

The add-on already publishes each reading to `wmbusmeters/<meter name>`, on
the Mosquitto broker of Home Assistant: give the integration the IP address of
Home Assistant, port 1883 and a user of that broker. The default topic
`wmbusmeters/#` covers this layout. If you also use the "MQTT Discovery"
integration of Gladys with the Home Assistant discovery of the add-on turned
on, your meters show up twice: add each one once.

## 3. Find your meters

wmbusmeters only publishes **the meters of its meter files**. First look at
what it hears: `docker logs -f wmbusmeters` prints, for each meter in range

```
Received telegram from: 12345678
          manufacturer: (SEN) Sensus Metering Systems, Germany (0x4cae)
                  type: Water meter (0x07) encrypted
                driver: iperl
```

The number (`12345678`) is printed on your meter. Create one file per meter
in `/opt/wmbusmeters/etc/wmbusmeters.d/`, for example `ColdWater`:

```ini
name=ColdWater
id=12345678
driver=iperl
key=00112233445566778899AABBCCDDEEFF
```

Remove the `key=` line if the meter is not encrypted, then
`docker restart wmbusmeters`. Use `driver=auto` only to try: wmbusmeters
guarantees that the fields of a named driver do not change between versions.

## 4. Encryption keys

**Many water meters are encrypted** (AES): without the key, wmbusmeters only
reads the meter number. The key of a remotely read meter belongs to the water
company (or to the building manager for the sub-meters of a block of flats):
ask for it, giving the meter number. Some give it, others do not. A key is 32
hexadecimal characters.

- The widespread **Diehl Izar** meters are read without a key
  (`driver=izarv2`).
- Without a key, the reading arrives with the `MISSING_KEY` status: the "List
  the meters heard" button points it out.
- With a **wrong key**, wmbusmeters logs "did you use the correct decryption
  key?" and **then ignores that meter**: nothing reaches Gladys. Fix the key
  and restart wmbusmeters.
- The French Gazpar gas meters (169 MHz) cannot be read: GRDF does not give
  out their keys.

## 5. Configure the integration

1. **Address of the MQTT broker**: as seen from the Gladys machine, its IP
   address on the local network, not `localhost` (the integration runs in its
   own container). Examples: `mqtt://192.168.1.10:1883`,
   `mqtts://broker.lan:8883`.
2. **User name** and **password** of the broker, if it asks for one.
3. **MQTT topic of wmbusmeters**: keep `wmbusmeters/#`, which covers
   `wmbusmeters/<number>` (the configuration above) and `wmbusmeters/<name>`
   (the add-on).
4. Click **Test the connection**: the integration waits for the first reading
   (up to 30 s; a reading retained by the broker with `-r` arrives at once) and
   names the meter heard.

## 6. Add your meters

Open the **Discovery** tab: every meter wmbusmeters publishes shows up, named
after its file, its driver and its number (`ColdWater (iperl 12345678)`). The
**List the meters heard** button shows the last readings, their values,
status and signal.

With a catch-all meter file (`id=*`), wmbusmeters also publishes the
neighbours' meters: add only yours. The others cost nothing (nothing is sent
to Gladys for a device you did not add) and leave the list after 4 days of
silence.

## Scenes

Every feature works in the "Device state change" trigger: for example **Leak
alarm** turns to 1 → notification, or **Volume** rising at night. The alarms
and the status are never delayed; an alarm goes back to 0 with the first
reading that no longer carries it.

## Options

| Option                            | Default         | Role                                                                 |
| --------------------------------- | --------------- | -------------------------------------------------------------------- |
| MQTT topic of wmbusmeters         | `wmbusmeters/#` | change only if your `shell=` publishes elsewhere                     |
| Verify the TLS certificate        | yes             | turn off for a broker with a self-signed certificate on your network |
| Minimum interval between readings | 60 s            | a meter transmitting every 8 s is only recorded at this pace         |

**Chatty meters**: an Izar transmits every 8 s, an iPERL every 16 s.
wmbusmeters has no rate limit: it publishes every telegram
(`ignoreduplicates=true` only drops the repeats of one telegram). The
integration keeps the last value of each meter and records it only at the
chosen interval, sends only the values that change (a stable value is sent
again every 30 min) and stays under the 300 states per minute Gladys accepts.

## Details

- The messages read are the JSON objects of wmbusmeters (`"_":"telegram"`, a
  number and a driver); any other message on the topic is ignored.
  wmbusmeters 3.0 and older (a `meter` field instead of `driver`) work too.
- The same reading received twice (two topics, a retained message replayed at
  the reconnection) counts once. A retained reading (`-r`) counts for the time
  wmbusmeters received it, not for now.
- The badge of an added device turns "unreachable" while the broker is down,
  and degraded (orange dot, with the reason) when the meter has sent nothing
  for 25 h: out of range, flat battery, or a meter that only transmits at
  certain hours (some walk-by meters are set up that way).
- The energy index of a heat meter measures heat, not electricity: do not
  attach it to your electricity meter in the Gladys energy monitoring.
- Implausible values (an unplugged probe at -100 °C…) are ignored.

## Troubleshooting

- **"No wmbusmeters reading"** at the test: `docker logs wmbusmeters`.
  "Received telegram from" but nothing published: the meter has no meter file.
  Nothing at all: check the receiver, the mode (`t1`, `c1`) and the range.
  Test the publication by hand:
  `docker exec wmbusmeters mosquitto_pub -h 192.168.1.10 -t wmbusmeters/test -m '{}'`.
- **"The MQTT broker is unreachable"**: check the IP address and the port,
  and that the broker accepts connections from the local network
  (`listener 1883` in Mosquitto 2).
- **"refused the connection"**: wrong user name or password, or an ACL that
  forbids reading `wmbusmeters/#`.
- **A meter only has its status**: `MISSING_KEY`, see the keys above.
- **A value is missing**: open an issue with the JSON of the reading
  (`mosquitto_sub -h 192.168.1.10 -t 'wmbusmeters/#' -v`).

## Privacy

Everything stays on your network: the integration only talks to your MQTT
broker. The password is stored as a secret by Gladys and never appears in the
logs. The keys of your meters stay in wmbusmeters: the integration never sees
them.
