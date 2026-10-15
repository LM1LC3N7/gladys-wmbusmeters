// -----------------------------------------------------------------------------
// Keys shared with the manifest (frozen: users store them in their
// configuration) and the tuning of the integration.
// -----------------------------------------------------------------------------

/** Manifest `actions` keys. */
export const ACTIONS = {
  TEST: 'test_connection',
  LIST: 'list_meters',
};

/** The `type` part of the external ids: ext:<selector>:wmbusmeters:<meter id> (forever). */
export const DEVICE_TYPE = 'wmbusmeters';

/** Reading throttling bounds (seconds), mirrored by the manifest. */
export const METER_INTERVAL = { min: 0, max: 3600, default: 60 };

export const LIMITS = {
  /** Gladys accepts 300 states per minute: keep a margin for the other paths. */
  statesPerMinute: 250,
  /** Meters kept in memory (a wildcard `id=*` meter file hears the neighbours too). */
  meters: 500,
  /** A wmbusmeters JSON is a few KB (the meters with 12 months of history); far larger is not one. */
  payloadBytes: 64 * 1024,
  /** Features of one meter (the allow-list keeps far fewer). */
  featuresPerMeter: 40,
  /** The status text feature. */
  statusText: 200,
  /** Meters described by the "list the meters heard" button. */
  listed: 20,
};

export const TIMINGS = {
  /** A new meter or field is published to Discovery after this pause... */
  publishDebounce: 2000,
  /** ...and the Discovery list at most this often. */
  publishMinGap: 30_000,
  /** The pending states are sent at this pace. */
  flushInterval: 1000,
  /** An unchanged value is re-sent this often, so it stays recently dated in Gladys. */
  stateHeartbeat: 30 * 60_000,
  /** A meter not heard for this long leaves the Discovery list (walk-by meters skip weekends). */
  forgetAfter: 4 * 24 * 3600_000,
  /** A created meter silent this long gets a degraded badge (some only transmit on working hours). */
  staleAfter: 25 * 3600_000,
  /** How often the transport badges of the created devices are checked. */
  staleCheck: 60_000,
  /** How long the connection test waits for a first meter reading. */
  testListen: 30_000,
  /** Broker connection timeout. */
  connectTimeout: 10_000,
  /** Delay between two reconnection attempts. */
  reconnectPeriod: 5000,
};
