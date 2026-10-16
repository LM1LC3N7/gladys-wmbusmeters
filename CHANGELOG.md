# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-16

### Added

- Reading wmbusmeters from the user's MQTT broker (mqtt, mqtts, ws, wss; user
  name and password; TLS verification can be turned off for a self-signed
  broker), on a configurable topic filter (`wmbusmeters/#` by default: the
  `wmbusmeters/<meter id>` of the guide and the `wmbusmeters/<meter name>` of
  the Home Assistant add-on). wmbusmeters 3.0 and older (`meter` instead of
  `driver`) and the details of `addtelegramdetails` are understood.
- One Discovery device per meter id, named after the meter file, its driver
  and its id; the meters silent for 4 days leave the list.
- Volume indexes and volumes at the billing date (m³), energy indexes (heat
  and electricity, production apart), energy at the billing date, power (W),
  flow and max flow (m³/h), flow, return and supply temperatures, heat cost
  allocation units, room temperature and humidity, voltage and current per
  phase, battery and battery life, radio signal. Histories, per-tariff totals
  and implausible values are left out.
- The status as a text feature, and binary alarms from its flags: leak,
  burst, dry meter, backflow, tamper, battery low. The alarms a meter can
  raise are offered before the first one, from its driver (a table generated
  from the wmbusmeters driver definitions) and from the flags it declares.
- Encrypted meters without their key (`MISSING_KEY`) and undecodable
  telegrams (`FAILED_DECODE`) pointed out in the logs and by the list button.
- The last values heard sent when a device is added; readings throttled to a
  configurable interval (60 s), the status and alarms never delayed, all
  states within the Gladys rate limit; a reading received twice counts once,
  a retained one for the time it was received.
- The transport badge: unreachable while the broker is down, degraded with
  the reason when a meter has been silent for 25 hours.
- "Test the connection" and "List the meters heard" buttons.

[Unreleased]: https://github.com/LM1LC3N7/gladys-wmbusmeters/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-wmbusmeters/releases/tag/v0.1.1
