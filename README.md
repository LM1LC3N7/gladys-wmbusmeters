# gladys-wmbusmeters

[Gladys Assistant](https://gladysassistant.com) external integration for the
**wireless M-Bus meters read by [wmbusmeters](https://github.com/wmbusmeters/wmbusmeters)**:
water meters (Sensus iPERL, Diehl Izar and Hydrus, Kamstrup Multical 21 and
flowIQ, Itron, Apator, Techem…), heat, gas and electricity meters, heat cost
allocators. wmbusmeters runs next to its radio receiver (RTL-SDR dongle,
iM871A, AMB8465…; the Gladys integration containers get no USB access) and
its `shell=` publishes every reading to the user's MQTT broker; the
integration offers every meter in the Discovery tab, with its index, flow,
temperatures, status and alarms. Unofficial, not affiliated with the
wmbusmeters project.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> Work in progress (0.1, not published to the store yet): announced on the
> [Gladys forum](https://community.gladysassistant.com/t/integrations-home-assistant-les-plus-populaires-candidates-pour-des-integrations-externes-gladys/10385/178).

## How it works

```
meter ))) receiver -> wmbusmeters (shell=mosquitto_pub "$METER_JSON") -> MQTT broker
                                                                              |
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (WmbusApp) ⇄ src/mqtt.js ---------+
                                   ├─ src/telegrams.js reading -> meter identity (pure)
                                   ├─ src/mapping.js   fields and flags -> Gladys features (pure)
                                   ├─ src/drivers.js   driver -> manufacturer, alarms (generated)
                                   ├─ src/devices.js   meters heard -> Discovery devices (pure)
                                   └─ src/publisher.js states within 300/min, throttling
```

- **Input**: subscribes to `wmbusmeters/#` (configurable) and keeps the JSON
  objects of wmbusmeters (`"_":"telegram"`, an id and a `driver`, called
  `meter` up to wmbusmeters 3.0): `wmbusmeters/<id>`, `wmbusmeters/<name>` (the Home
  Assistant add-on) and any other layout work. A reading received twice (two
  topics, a retained replay) counts once; a retained one counts for its
  `timestamp`.
- **Devices**: one per meter id, external id `wmbusmeters:<id>`, whatever the
  driver (izar → izarv2) or the meter file name. Features keyed by the
  wmbusmeters field name. Discovery published 2 s after a new meter or field,
  at most every 30 s; meters silent for 4 days leave the list.
- **Fields** (an allow-list, by suffix and prefix): volume indexes and the
  volume at the billing date (m³), energy indexes (consumption and production
  apart) and energy at the billing date (kWh), power (kW → W), flow and max
  flow (m³/h), flow/return/supply temperatures (probe type), heat cost units,
  room temperature and humidity, voltage and current per phase, battery %,
  battery life (years), signal (dBm → bars). Histories, per-tariff and
  per-phase totals, dates and implausible values are left out.
- **Status and alarms**: `status` / `current_status` / the `current_alarms` of
  the old izar driver become a text feature and binary alarms (leak, burst,
  dry, backflow → leak-sensor; tamper; battery low) from their flag words,
  flags about the past excluded. The alarms a meter can raise are offered
  before the first one: from its driver (`src/drivers.js`), from the flags it
  declares with `addtelegramdetails`, else when first seen. `MISSING_KEY` and
  `FAILED_DECODE` are pointed out.
- **States**: only for the devices the user created, the last values heard
  sent at creation; deduplicated, budgeted at 250/min, measurements throttled
  to the configured interval (60 s), status and alarms never delayed.
- **Transport badge**: unreachable while the broker is down, degraded (with
  the reason) for a meter silent for 25 h.
- **Buttons**: "Test the connection" waits for a first reading (a retained one
  is reported with its age); "List the meters heard" shows the last ones with
  their values, status and signal.

### What it adds to the Home Assistant discovery of wmbusmeters

wmbusmeters itself publishes no discovery: only its Home Assistant add-on
does, when `enable_mqtt_discovery` is on (stable: hand-written templates for
about 40 drivers; edge: generated from every driver with
`addtelegramdetails`). With it, [gladys-mqtt-discovery](https://github.com/LM1LC3N7/gladys-mqtt-discovery)
already shows the add-on's meters. This integration adds: every wmbusmeters
install (Docker, Raspberry Pi, snap) and every driver, without Home
Assistant; Gladys-native features (a volume index in m³, energy indexes for
the Gladys energy views, power in W, flow); the status flags turned into leak,
burst, dry, backflow, tamper and battery-low alarms usable in scenes; the
silent-meter badge; the missing-key diagnosis; the throttling of chatty
meters; one device per meter id that survives a driver change.

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .  # store admission checks
```

`test/fixtures/telegrams.js` holds the JSON printed by the real wmbusmeters
(official Docker image) for the test telegrams of its drivers: program
output, generated, never edited. The integration was also run end to end
against the real wmbusmeters daemon (official image, development build and
release 3.0.0) replaying a timed simulation file, with meter files and keys
like a user's, its `shell=` publishing through mosquitto_pub to a real
Mosquitto 2: topic per id with `addtelegramdetails=first`, topic per name
retained (the add-on layout), encrypted meters with and without their key.

`src/drivers.js` is regenerated with `npm run drivers` from the driver
definitions of a wmbusmeters checkout (instructions in
`scripts/drivers.mjs`).

## Credits

- [wmbusmeters](https://github.com/wmbusmeters/wmbusmeters) by Fredrik
  Öhrström and contributors (GPL-3.0-or-later) does all the radio decoding.
  The integration runs it as a separate program and only reads its output;
  `src/drivers.js` keeps facts from its driver definitions (driver names,
  manufacturers, which alarm families their status flags raise), no code.
- The [wmbusmeters Home Assistant add-on](https://github.com/wmbusmeters/wmbusmeters-ha-addon)
  for the `wmbusmeters/<meter name>` topic layout and the
  `addtelegramdetails` flag details.
- [MQTT.js](https://github.com/mqttjs/MQTT.js) (MIT) for the broker
  connection.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release. The
`gladys-assistant-integration` topic is added at the first real release only.

## License

Apache-2.0.
