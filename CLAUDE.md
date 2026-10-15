# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15). It reads
the JSON readings of [wmbusmeters](https://github.com/wmbusmeters/wmbusmeters)
(wireless M-Bus water, heat, gas and electricity meters) from the user's MQTT
broker, where the `shell=` of wmbusmeters publishes them with mosquitto_pub,
and turns them into Gladys devices and states. wmbusmeters runs next to its
radio receiver: the integration container has no USB access. Not affiliated
with wmbusmeters.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npm run drivers -- drivers.jsonl <commit> # regenerate src/drivers.js (see the script), then format
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` and `audit` before every commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          WmbusApp: broker link, readings -> meters, Discovery,
                    states, status and alarms, badges, both buttons
src/telegrams.js    payload -> wmbusmeters reading, meter identity (pure)
src/mapping.js      wmbusmeters fields and flags -> Gladys features (pure)
src/drivers.js      GENERATED: driver -> manufacturer, alarm families
src/devices.js      meters heard -> Gladys devices (pure)
src/publisher.js    states within the Gladys rate limit, throttling
src/mqtt.js         the broker connection (mqtt.js)
src/config.js       config_schema normalized
src/constants.js    manifest keys, limits, timings
src/i18n.js         runtime texts (en/fr)
scripts/drivers.mjs regenerates src/drivers.js from the wmbusmeters drivers
test/fixtures/      readings printed by the REAL wmbusmeters (generated)
test/helpers/       a fake mqtt.js client; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device = `wmbusmeters:<meter id>` (lowercase),
  feature = `<device>:<key>`, the key being the wmbusmeters field name
  (`total_m3`, `flow_temperature_c`...) or `status`, `alarm_<family>`,
  `battery_low`. Never change how they are built.
- Manifest keys (`test_connection`, `list_meters`, the config keys) are
  frozen: users store them.
- Field names come from wmbusmeters (its drivers keep them stable); add a
  fixture printed by the real wmbusmeters with any new mapping, never an
  invented reading. `test/fixtures/telegrams.js` is generated (see its header)
  and left out of Prettier.
- Never reimplement the telegram decoding: wmbusmeters (GPL-3.0) runs outside
  the integration; only facts from its definitions (driver names,
  manufacturers, flag families) are kept, in the generated `src/drivers.js`.
- Each Gladys feature has one unit: convert in `src/mapping.js` (kW -> W).
- Container limits: 256 MB RAM, 0.5 CPU, read-only rootfs, only `/data`
  writable, bridge network (unicast to the LAN only, no USB).
- Gladys rate limits: 300 states/min. A catch-all meter file publishes the
  neighbours' meters too: nothing is sent for a device the user did not add.
- Never log or put in a status message a password, a secret config value or
  a meter key.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Versions belong to the Release workflow; every user-visible change adds a
  line under `## [Unreleased]` in `CHANGELOG.md`.
