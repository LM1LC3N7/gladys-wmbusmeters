// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { METER_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  server_url: '',
  username: '',
  password: '',
  topic: 'wmbusmeters/#',
  verify_certificate: true,
  meter_interval: METER_INTERVAL.default,
};

const MQTT_SCHEMES = ['mqtt:', 'mqtts:', 'ws:', 'wss:', 'tcp:', 'ssl:'];

/**
 * The broker wmbusmeters publishes to ("192.168.1.10" -> "mqtt://192.168.1.10").
 * @returns {{ url: string } | { error: string }}
 */
export function parseServerUrl(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { error: 'empty' };
  }
  const withScheme = /^[a-z]+:\/\//i.test(text) ? text : `mqtt://${text}`;
  let url;
  try {
    url = new URL(withScheme);
  } catch {
    return { error: 'invalid' };
  }
  if (!MQTT_SCHEMES.includes(url.protocol) || !url.hostname) {
    return { error: 'invalid' };
  }
  if (url.username || url.password) {
    // Credentials belong to their own fields (the secret one is never shown again).
    return { error: 'credentials' };
  }
  return { url: url.toString().replace(/\/$/, '') };
}

/** An MQTT topic filter: `+` alone in its level, `#` last. Anything else -> the default. */
export function normalizeTopic(raw) {
  const text = String(raw ?? '').trim();
  const levels = text.split('/');
  const valid =
    text !== '' &&
    levels.every(
      (level, i) =>
        (!level.includes('+') || level === '+') &&
        (!level.includes('#') || (level === '#' && i === levels.length - 1)),
    );
  return valid ? text : DEFAULTS.topic;
}

export function normalizeConfig(raw = {}) {
  const given = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, v]) => v !== null && v !== undefined),
  );
  const c = { ...DEFAULTS, ...given };
  const server = parseServerUrl(c.server_url);
  const interval = Number(c.meter_interval);
  return {
    url: server.url,
    urlError: server.error,
    username: String(c.username ?? '').trim(),
    password: String(c.password ?? ''),
    topic: normalizeTopic(c.topic),
    verifyCertificate: c.verify_certificate !== false,
    meterInterval: Number.isFinite(interval)
      ? Math.max(METER_INTERVAL.min, Math.min(METER_INTERVAL.max, Math.round(interval)))
      : METER_INTERVAL.default,
  };
}
