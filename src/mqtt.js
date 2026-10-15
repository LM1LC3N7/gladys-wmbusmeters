// -----------------------------------------------------------------------------
// The MQTT connection to the broker wmbusmeters publishes to (its `shell=`
// runs mosquitto_pub with the JSON of each reading).
//
// A thin factory over mqtt.js, so the tests can hand a fake client to the app.
// The client reconnects by itself; the app subscribes again on every `connect`
// (clean session).
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import mqtt from 'mqtt';
import { LIMITS, TIMINGS } from './constants.js';

/** MQTT 3.1.1 CONNACK refusals worth a precise message. */
export const REFUSALS = {
  1: 'unacceptable protocol version',
  2: 'identifier rejected',
  3: 'server unavailable',
  4: 'bad user name or password',
  5: 'not authorized',
  134: 'bad user name or password',
  135: 'not authorized',
};

export function connectBroker(config, { connect = mqtt.connect } = {}) {
  return connect(config.url, {
    username: config.username || undefined,
    password: config.password || undefined,
    // A random client id: two instances (a test and a restart) never kick each other out.
    clientId: `gladys_wmbusmeters_${randomBytes(4).toString('hex')}`,
    clean: true,
    keepalive: 60,
    connectTimeout: TIMINGS.connectTimeout,
    reconnectPeriod: TIMINGS.reconnectPeriod,
    rejectUnauthorized: config.verifyCertificate,
    protocolVersion: 4,
    resubscribe: false,
  });
}

/** A readable reason for a connection error (never the password). */
export function errorReason(err) {
  if (!err) {
    return 'unknown error';
  }
  if (err.code !== undefined && REFUSALS[err.code]) {
    return REFUSALS[err.code];
  }
  if (typeof err.code === 'string') {
    return `${err.code}${err.address ? ` ${err.address}${err.port ? `:${err.port}` : ''}` : ''}`;
  }
  return String(err.message ?? err).slice(0, 200);
}

export const isRefusal = (err) => err?.code !== undefined && [4, 5, 134, 135].includes(err.code);

export const tooLarge = (payload) => payload?.length > LIMITS.payloadBytes;
