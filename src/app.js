// -----------------------------------------------------------------------------
// The integration: one connection to the user's MQTT broker, the meters heard
// on it, the Discovery list built from them, and the values, status and
// alarms sent for the devices the user created. index.js only wires the SDK
// handlers to it.
//
// The radio dongle is never plugged into Gladys: wmbusmeters runs next to it
// (the integration containers get no USB access), decodes the telegrams and
// publishes one JSON per reading with its `shell=` (mosquitto_pub).
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import { DEVICE_TYPE, LIMITS, TIMINGS } from './constants.js';
import { buildDevices, sortKeys } from './devices.js';
import { T, ago, describeValues } from './i18n.js';
import { ALARM_KEYS, STATUS_KEY, isThrottled, knownFamilies, readTelegram } from './mapping.js';
import { connectBroker, errorReason, isRefusal, tooLarge } from './mqtt.js';
import { StatePublisher } from './publisher.js';
import { identify, parseTelegram, receivedAt, rssiOf } from './telegrams.js';

/** The feature key of a feature external id (`<device>:<key>`). */
const keyOf = (featureId) => featureId.slice(featureId.lastIndexOf(':') + 1);
const FAMILIES = Object.keys(ALARM_KEYS);

/** What a status says about the decoding: the key is missing, or wrong. */
const problemOf = (words) =>
  words.includes('MISSING_KEY')
    ? 'missingKey'
    : words.includes('FAILED_DECODE')
      ? 'failedDecode'
      : undefined;

export class WmbusApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'wmbusmeters' }),
    connect = connectBroker,
    now = Date.now,
    timers = globalThis,
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.connect = connect;
    this.now = now;
    this.timers = timers;
    this.config = normalizeConfig();
    /** device external id -> meter heard, least recently heard first */
    this.meters = new Map();
    this.createdDevices = new Set();
    this.createdFeatures = new Set();
    /** deviceId -> transport entry last published (JSON) */
    this.transports = new Map();
    this.client = null;
    this.linkUp = false;
    this.rebuildTimer = undefined;
    this.staleTimer = undefined;
    this.lastPublish = -Infinity;
    this.startedAt = undefined;
    this.generation = 0;
    this.lastStatus = undefined;
    this.warned = new Set();
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    const generation = this.generation;
    this.config = normalizeConfig(raw);
    this.startedAt ??= this.now();
    this.refreshCreated();
    if (this.config.urlError) {
      await this.setStatus(
        false,
        this.config.urlError === 'empty' ? T.notConfigured : T.badUrl(this.config.urlError),
      );
      return;
    }
    await this.setStatus(false, T.connecting);
    this.publisher.configure({
      intervalSeconds: this.config.meterInterval,
      isThrottled: (featureId) => isThrottled(keyOf(featureId)),
    });
    this.publisher.start();
    this.staleTimer = this.timers.setInterval(() => {
      this.publishAllTransports().catch((err) =>
        this.logger.warn(`Transport badges failed: ${err.message}`),
      );
    }, TIMINGS.staleCheck);
    const client = this.connect(this.config);
    this.client = client;
    const current = () => generation === this.generation && this.client === client;
    client.on('connect', () => {
      if (current()) {
        this.onConnect(client).catch((err) =>
          this.logger.error(`After connection: ${err.message}`),
        );
      }
    });
    client.on('message', (topic, payload, packet) => {
      if (current()) {
        this.onMessage(payload, packet?.retain === true);
      }
    });
    client.on('error', (err) => {
      if (current()) {
        const reason = errorReason(err);
        this.logger.warn(`MQTT broker: ${reason}`);
        this.linkUp = false;
        this.setStatus(false, isRefusal(err) ? T.refused(reason) : T.unreachable(reason));
      }
    });
    client.on('close', () => {
      if (current()) {
        if (this.linkUp) {
          this.linkUp = false;
          this.setStatus(false, T.unreachable('connection lost'));
        }
        this.publishAllTransports().catch(() => {});
      }
    });
  }

  stop() {
    this.generation += 1;
    this.timers.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    this.timers.clearInterval(this.staleTimer);
    this.staleTimer = undefined;
    this.publisher.stop();
    if (this.client) {
      this.client.removeAllListeners?.();
      this.client.on?.('error', () => {});
      this.client.end(true);
      this.client = null;
    }
    this.linkUp = false;
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  warnOnce(key, message) {
    if (!this.warned.has(key) && this.warned.size < 1000) {
      this.warned.add(key);
      this.logger.warn(message);
    }
  }

  async onConnect(client) {
    this.logger.info(`Connected to ${this.config.url}`);
    client.subscribe([this.config.topic], { qos: 0 }, (err) => {
      if (err) {
        this.logger.warn(`Subscription to ${this.config.topic} failed: ${err.message}`);
      }
    });
    this.linkUp = true;
    await this.setStatus(true, this.statusMessage());
    await this.publishAllTransports();
  }

  statusMessage() {
    const heard = this.offeredMeters().length;
    return heard === 0
      ? T.waiting(this.config.topic)
      : T.connected(heard, this.createdDevices.size);
  }

  // --- Readings --------------------------------------------------------------

  onMessage(payload, retained = false) {
    if (tooLarge(payload)) {
      this.warnOnce('large', `A message larger than ${LIMITS.payloadBytes} bytes was ignored`);
      return;
    }
    const telegram = parseTelegram(payload);
    if (telegram) {
      this.onTelegram(telegram, retained, payload?.length ?? 0);
    }
  }

  onTelegram(telegram, retained = false, size = 0) {
    const now = this.now();
    const identity = identify(telegram);
    const ids = this.gladys.externalIds(DEVICE_TYPE, identity.platformId);
    // The same reading twice (published on two topics, a retained one replayed
    // at each reconnection): once.
    const stamp = `${telegram.timestamp}|${size}`;
    if (typeof telegram.timestamp === 'string' && this.meters.get(ids.device)?.stamp === stamp) {
      return;
    }
    // A retained reading is as old as its timestamp says, not "now".
    const at = receivedAt(telegram);
    const heardAt = retained && at !== undefined ? Math.min(now, at) : now;
    const meter = this.remember(ids.device, identity, telegram, heardAt);
    meter.stamp = stamp;
    const { readings, status } = readTelegram(telegram);
    let changed = false;
    for (const r of readings) {
      if (this.addKey(meter, r.key)) {
        changed = true;
      }
      if (meter.keys.has(r.key)) {
        this.setValue(meter, ids, r.key, { state: r.state });
      }
    }
    if (status) {
      changed = this.onStatus(meter, ids, telegram, status) || changed;
    }
    if (changed) {
      this.scheduleRebuild();
    }
    if (this.createdDevices.has(ids.device)) {
      this.publishAllTransports().catch(() => {});
    }
  }

  /** The status text and the alarms of the meter. */
  onStatus(meter, ids, telegram, status) {
    let changed = this.addKey(meter, STATUS_KEY);
    for (const family of [...knownFamilies(telegram, meter.driver), ...status.families]) {
      meter.families.add(family);
    }
    for (const family of FAMILIES.filter((f) => meter.families.has(f))) {
      changed = this.addKey(meter, ALARM_KEYS[family]) || changed;
    }
    this.setValue(meter, ids, STATUS_KEY, { text: status.text });
    for (const family of FAMILIES) {
      if (meter.keys.has(ALARM_KEYS[family])) {
        this.setValue(meter, ids, ALARM_KEYS[family], {
          state: status.families.has(family) ? 1 : 0,
        });
      }
    }
    const problem = problemOf(status.words);
    if (problem === 'missingKey') {
      this.warnOnce(
        `key:${meter.id}`,
        `${meter.name}: the telegrams are encrypted and wmbusmeters has no key for this meter (MISSING_KEY)`,
      );
    } else if (problem === 'failedDecode') {
      this.warnOnce(
        `decode:${meter.id}`,
        `${meter.name}: wmbusmeters could not decode a telegram (FAILED_DECODE)`,
      );
    }
    meter.problem = problem;
    return changed;
  }

  setValue(meter, ids, key, value) {
    meter.values.set(key, value);
    const featureId = ids.feature(key);
    if (this.createdFeatures.has(featureId)) {
      this.publisher.push(featureId, value);
    }
  }

  /** The record of a meter, moved to the end (most recently heard). */
  remember(deviceId, identity, telegram, heardAt) {
    let meter = this.meters.get(deviceId);
    if (meter) {
      this.meters.delete(deviceId);
      Object.assign(meter, identity);
    } else {
      meter = {
        ...identity,
        deviceId,
        keys: new Set(),
        values: new Map(),
        families: new Set(),
        count: 0,
        lastSeen: -Infinity,
      };
    }
    this.meters.set(deviceId, meter);
    meter.count += 1;
    meter.lastSeen = Math.max(meter.lastSeen, heardAt);
    meter.rssi = rssiOf(telegram) ?? meter.rssi;
    this.evict();
    return meter;
  }

  /** Over the limit: forget the meters heard least recently, never a created one. */
  evict() {
    if (this.meters.size <= LIMITS.meters) {
      return;
    }
    for (const [deviceId] of this.meters) {
      if (this.meters.size <= LIMITS.meters) {
        break;
      }
      if (!this.createdDevices.has(deviceId)) {
        this.meters.delete(deviceId);
      }
    }
  }

  /** A feature the meter never had: the Discovery list changes. */
  addKey(meter, key) {
    if (meter.keys.has(key)) {
      return false;
    }
    if (meter.keys.size >= LIMITS.featuresPerMeter) {
      this.warnOnce(
        `features:${meter.id}`,
        `${meter.name}: too many fields, the next ones are left out`,
      );
      return false;
    }
    meter.keys.add(key);
    return true;
  }

  // --- Discovery -------------------------------------------------------------

  /** The meters offered in Discovery: heard in the last days, or created. */
  offeredMeters(now = this.now()) {
    return [...this.meters.values()].filter(
      (m) =>
        m.keys.size > 0 &&
        (this.createdDevices.has(m.deviceId) || now - m.lastSeen < TIMINGS.forgetAfter),
    );
  }

  /** Publish at most every 30 s (a wildcard meter file hears the neighbours). */
  scheduleRebuild() {
    if (this.rebuildTimer !== undefined) {
      return;
    }
    const generation = this.generation;
    const delay = Math.max(
      TIMINGS.publishDebounce,
      this.lastPublish + TIMINGS.publishMinGap - this.now(),
    );
    this.rebuildTimer = this.timers.setTimeout(() => {
      this.rebuildTimer = undefined;
      if (generation === this.generation) {
        this.rebuild().catch((err) =>
          this.logger.error(`Publishing the discovered devices failed: ${err.message}`),
        );
      }
    }, delay);
  }

  async rebuild() {
    this.timers.clearTimeout(this.rebuildTimer);
    this.rebuildTimer = undefined;
    const now = this.now();
    this.lastPublish = now;
    for (const meter of [...this.meters.values()]) {
      if (!this.createdDevices.has(meter.deviceId) && now - meter.lastSeen >= TIMINGS.forgetAfter) {
        this.meters.delete(meter.deviceId);
      }
    }
    await this.gladys
      .publishDiscoveredDevices(buildDevices(this.gladys, this.offeredMeters(now)))
      .catch((err) => this.logger.warn(`Publishing the discovered devices failed: ${err.message}`));
    await this.refreshStatus();
  }

  // --- Devices created by the user -------------------------------------------

  refreshCreated() {
    const devices = this.gladys.devices ?? [];
    this.createdDevices = new Set(devices.map((d) => d.external_id));
    this.createdFeatures = new Set(
      devices.flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  async deviceCreated(device) {
    this.refreshCreated();
    this.transports.delete(device?.external_id);
    const meter = this.meters.get(device?.external_id);
    for (const f of device?.features ?? []) {
      // The last values heard before the creation.
      const value = meter?.values.get(keyOf(f.external_id));
      if (value) {
        this.publisher.push(f.external_id, value);
      }
    }
    await this.publishAllTransports().catch(() => {});
    await this.refreshStatus();
  }

  async deviceDeleted(device) {
    this.refreshCreated();
    if (device?.external_id) {
      this.transports.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
    await this.refreshStatus();
  }

  /** The status counts the devices in Gladys. */
  async refreshStatus() {
    if (this.linkUp) {
      await this.setStatus(true, this.statusMessage());
    }
  }

  /**
   * The badge of a created meter: unreachable while the broker is down;
   * degraded (with the reason) when the meter has been silent for a day.
   */
  transportOf(device, now) {
    if (!this.linkUp) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const lastSeen = this.meters.get(device.external_id)?.lastSeen ?? this.startedAt ?? now;
    const silent = now - Math.max(lastSeen, this.startedAt ?? lastSeen);
    if (silent >= TIMINGS.staleAfter) {
      return {
        transport: DEVICE_TRANSPORTS.LOCAL,
        degraded: true,
        message: T.silent(Math.floor((now - lastSeen) / 3600_000)),
      };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async publishAllTransports() {
    const now = this.now();
    const entries = [];
    for (const device of this.gladys.devices ?? []) {
      const entry = this.transportOf(device, now);
      const key = JSON.stringify([entry.transport, entry.degraded === true]);
      if (this.transports.get(device.external_id) !== key) {
        this.transports.set(device.external_id, key);
        entries.push({ external_id: device.external_id, ...entry });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      await this.gladys.publishTransports(entries.slice(i, i + 100));
    }
  }

  // --- Configuration screen buttons ------------------------------------------

  /** Connects with the saved configuration and waits for a first wmbusmeters reading. */
  testConnection() {
    const config = this.config;
    if (config.urlError) {
      return Promise.resolve(
        config.urlError === 'empty' ? T.notConfigured : T.badUrl(config.urlError),
      );
    }
    return new Promise((resolve) => {
      const started = this.now();
      let probe;
      let timer;
      const finish = (answer) => {
        this.timers.clearTimeout(timer);
        probe?.removeAllListeners?.();
        probe?.on?.('error', () => {});
        probe?.end(true);
        resolve(answer);
      };
      try {
        probe = this.connect({ ...config });
      } catch (err) {
        finish(T.unreachable(errorReason(err)));
        return;
      }
      timer = this.timers.setTimeout(
        () => finish(T.unreachable('timeout')),
        TIMINGS.connectTimeout + 1000,
      );
      probe.on('error', (err) => {
        const reason = errorReason(err);
        finish(isRefusal(err) ? T.refused(reason) : T.unreachable(reason));
      });
      probe.on('message', (topic, payload, packet) => {
        const telegram = tooLarge(payload) ? null : parseTelegram(payload);
        if (telegram) {
          const at = receivedAt(telegram);
          const age =
            packet?.retain === true && at !== undefined ? ago(this.now() - at) : undefined;
          const seconds = Math.round((this.now() - started) / 1000);
          finish(T.test.ok(identify(telegram).name, seconds, age, this.offeredMeters().length));
        }
      });
      probe.on('connect', () => {
        probe.subscribe([config.topic], { qos: 0 });
        this.timers.clearTimeout(timer);
        timer = this.timers.setTimeout(
          () => finish(T.test.silent(config.topic, TIMINGS.testListen / 1000)),
          TIMINGS.testListen,
        );
      });
    });
  }

  /** The meters heard, most recent first, with their last values: which ones are mine? */
  listMeters() {
    const now = this.now();
    const meters = [...this.meters.values()].reverse();
    const lines = [];
    if (meters.length === 0) {
      lines.push(T.list.empty);
    } else {
      const shown = meters.slice(0, LIMITS.listed);
      lines.push(T.list.header(meters.length, shown.length));
      for (const m of shown) {
        const values = describeValues(
          sortKeys(m.keys)
            .filter((k) => k !== STATUS_KEY && m.values.get(k)?.state !== undefined)
            .filter((k) => !Object.values(ALARM_KEYS).includes(k))
            .map((k) => [k, m.values.get(k).state]),
        );
        lines.push(
          T.list.line({
            name: m.name,
            values,
            status: m.values.get(STATUS_KEY)?.text,
            count: m.count,
            since: ago(now - m.lastSeen),
            rssi: m.rssi,
            created: this.createdDevices.has(m.deviceId),
          }),
        );
        if (m.problem) {
          lines.push(T.list[m.problem]);
        }
      }
    }
    return {
      en: lines.map((l) => l.en).join('\n'),
      fr: lines.map((l) => l.fr).join('\n'),
    };
  }
}
