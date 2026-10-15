# TODO — wmbusmeters v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`,
  `npm run audit`, then update README, `docs/en.md`, `docs/fr.md`,
  `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only (before, the store would list an empty integration).
- No forum topic of its own, ever, and no forum post from a module session:
  the batch claimed in /t/10385 (post #178) gets one recap message there, with
  a link to each repo, once the ten are published.

## Status

- [x] **Milestone 1 — core** (2026-10-15): MQTT input (any topic layout,
      `meter`/`driver`, `addtelegramdetails`), one device per meter id,
      allow-list mapping of volumes, energies, power, flow, temperatures, heat
      cost units, room sensors, phases, battery, signal; status text and
      alarm features (leak, burst, dry, backflow, tamper, battery low) from
      the flags, offered before the first alarm through a driver table
      generated from the wmbusmeters definitions; MISSING_KEY / FAILED_DECODE
      diagnosis; throttling, deduplication, retained readings, last values at
      creation; transport badge (unreachable, degraded when silent 25 h); both
      buttons; manifest; docs en/fr (Docker, Raspberry Pi, HA add-on, keys,
      chatty meters). 59 unit tests on 81 readings printed by the real
      wmbusmeters; end to end against the real wmbusmeters daemon (official
      image: development build 5516615 and release 3.0.0) replaying a timed
      simulation through its `shell=` mosquitto_pub into Mosquitto 2.
- [ ] **Milestone 2 — real meters**: testers with a receiver (RTL-SDR, iM871A)
      and French meters (Itron Intelis/Cyble 5, Diehl Izar R4 and Hydrus,
      Sensus iPERL, Kamstrup flowIQ, Techem MK Radio, Qundis); collect their
      `mosquitto_sub -v` lines as fixtures; check the alarm flags really sent
      on a leak, the transmit periods, walk-by meters and the 25 h badge.
- [ ] **Milestone 3 — more fields**: per-tariff energy totals when the plain
      total is absent (some amiplus meters), the `last_month_total_m3` of the
      old izar driver, heat cost allocator set dates, water meter
      `consumption_at_set_date_m3`, an opt-in "all numeric fields" mode for
      the meters the allow-list does not cover, a daily consumption derived
      from the index.
- [ ] **Milestone 4 — first release**: cover image, Docker image build check,
      `npx github:GladysAssistant/integration-store .`, Release workflow,
      topic, GHCR package public.

## Decisions

- **Reuse, never reimplement the decoding**: wmbusmeters (GPL-3.0, active:
  last commit 2026-10-15, releases 1.20, 2.0 and 3.0.0 in 2026, Docker image
  rebuilt from master, 124 xmq drivers + 4 C++ ones, the HA add-on) does the
  radio, the link layer, the AES keys and the drivers. It runs outside Gladys
  (the sub-containers only get coral/gpu/video, never a serial or SDR dongle)
  and the integration only reads its JSON. The active JavaScript parser of
  ioBroker (npm `wireless-mbus-parser`) was not used: the radio has to sit
  outside Gladys anyway, wmbusmeters is the reference with the most drivers
  and receivers, and a second decoder would be a second thing to maintain.
  The other npm `wmbus` packages are abandoned (2017-2022).
- **MQTT through `shell=`**: wmbusmeters has no MQTT client (verified in its
  README and sources: only `shell=` / `metershell=` and `mosquitto_pub`,
  which the official image ships). The guide gives the `shell=` line; the
  integration connects to the user's broker with `mqtt` (MQTT.js), as
  gladys-rtl433 does, and subscribes to `wmbusmeters/#`, which covers the
  README layout (`wmbusmeters/$METER_ID`) and the add-on one
  (`wmbusmeters/$METER_NAME`).
- **Home Assistant discovery**: only the add-on publishes it, opt-in
  (`enable_mqtt_discovery`): hand-written templates for ~40 drivers in the
  stable add-on, generated from every driver with `addtelegramdetails` in the
  edge one. gladys-mqtt-discovery covers those users; this module serves every
  install, maps to Gladys-native features and adds the alarms, the badge,
  the key diagnosis and the throttling. The docs warn about duplicates.
- **Identity = the meter id**, lowercase, nothing else: the driver changes
  (izar → izarv2, auto → named) and the meter file name is the user's. Two
  meter files on the same id would merge (accepted: wmbusmeters warns
  against it).
- **Feature key = the wmbusmeters field name**: wmbusmeters promises that a
  named driver keeps its field names. An allow-list (suffix `_m3`, `_kwh`,
  `_kw`, `_m3h`, `_c`, `_rh`, `_v`, `_a`, `_hca`, `_pct`, `_y`, `_dbm` plus a
  prefix) keeps the useful ones; histories, set dates other than the billing
  date, per-tariff and per-phase totals, maxima and averages are left out.
  Derived keys: `status`, `alarm_leak|burst|dry|backflow|tamper`,
  `battery_low`.
- **Gladys features**: volume = `volume-sensor`/`decimal` in m³ (the only
  volume type; the index for the water meters); energy totals =
  `energy-sensor`/`index` (consumption) or `energy-production-sensor`/`index`;
  the billing-date energy is `energy` (not an index, so the energy views do
  not count it twice); power in W; flow = `water-valve`/`flow`, the only type
  Gladys gives the `cubic-meter-per-hour` unit (rendered as a number badge
  when read-only); water temperatures = `temperature-sensor`/`probe` (out of
  the room averages); heat cost units = `counter-sensor`/`integer` without
  unit; battery life = `duration` in years; RSSI = `signal` from -110 to -40
  dBm (5 bars).
- **Alarms**: leak, burst, dry and backflow are `leak-sensor` binaries (the
  Gladys front shows them red when 1 and never as "no recent value"; there is
  no generic problem category); tamper = `tamper`, battery low =
  `battery-low`. Families by regex on the flag words (`LEAK`, `BURST`,
  `DRY`, `REVERSE`/`BACKFLOW`, `TAMPER`/`SABOTAGE`/`FRAUD`/`MAGNETIC`...,
  `BATTERY`/`POWER_LOW`), history flags (`PREV_`, `WAS_`, `_THIS_MONTH`,
  `_DATE`...) excluded. Offered before the first alarm from (1) the driver
  table, (2) the flags declared by `addtelegramdetails` (wmbusmeters after
  3.0.0), (3) any `status` field (the OMS transport status carries
  POWER_LOW); otherwise added when first seen. An alarm only changes with a
  reading that carries a status.
- **Driver table** (`src/drivers.js`): generated by `scripts/drivers.mjs`
  from the xmq definitions converted with the `xmq` tool of the official
  image (which needs `apk add libxslt`: missing from the image). Only the
  lookups of status fields (`status`, `INJECT_INTO_STATUS`...) count, not
  e.g. the `contents` bits of hydrodigit. The 4 C++ drivers are hand-written.
- **Fixtures** = the output of the real program (`e2e/wmbus-fixtures.sh` runs
  the official image on the test telegrams of the drivers), so no GPL source
  is copied into this Apache-2.0 repo; excluded from Prettier.
- **Timestamps**: a reading identical in timestamp and size to the last one
  of its meter is skipped (two topics, retained replays); a retained reading
  counts for its `timestamp` (bounded by now), a live one for now. States
  carry no `created_at`.
- **Throttling**: wmbusmeters has no rate limit (only `ignoreduplicates`);
  the integration keeps the last value, records measurements every 60 s by
  default (configurable 0 to 3600 s), never delays the status and alarms,
  dedups with `publishChangedStates` (30 min heartbeat) under 250 states/min.
- **Badge**: unreachable only while the broker is down; a meter silent 25 h
  stays `local` but degraded with the reason (walk-by meters may only
  transmit at certain hours: unreachable would flap).
- **Not offered**: scene triggers (the binary alarms already trigger scenes on
  a state change), polling (push only), any command (meters are read-only).
