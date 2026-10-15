// -----------------------------------------------------------------------------
// One MQTT message -> a wmbusmeters reading and the identity of its meter (pure).
//
// wmbusmeters (format=json) prints one flat JSON object per decoded telegram:
//   {"_":"telegram","media":"water","driver":"iperl","name":"MyTapWater",
//    "id":"33225544","total_m3":123.529,"max_flow_m3h":0,"status":"OK",
//    "timestamp":"2026-10-15T18:37:00Z"}
// and its `shell=` hands it to mosquitto_pub ($METER_JSON). Up to the 3.0.0
// release the driver is called `meter`. Anything else on the topic (an
// alarmshell text, another tool's JSON) is ignored.
// -----------------------------------------------------------------------------

/** The JSON object of a wmbusmeters reading, or null. */
export function parseTelegram(payload) {
  const text = (Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '')).trim();
  if (!text.startsWith('{')) {
    return null;
  }
  let telegram;
  try {
    telegram = JSON.parse(text);
  } catch {
    return null;
  }
  if (!telegram || typeof telegram !== 'object' || Array.isArray(telegram)) {
    return null;
  }
  if (telegram._ !== undefined && telegram._ !== 'telegram') {
    return null;
  }
  const driver = telegram.driver ?? telegram.meter;
  return idOf(telegram) !== undefined && typeof driver === 'string' && driver.trim() !== ''
    ? telegram
    : null;
}

/** The meter id (8 digits, printed on the meter; hex for a few makes), or undefined. */
function idOf(telegram) {
  const id = typeof telegram.id === 'number' ? String(telegram.id) : telegram.id;
  return typeof id === 'string' && /^[0-9A-Fa-f]{1,16}$/.test(id.trim())
    ? id.trim().toLowerCase()
    : undefined;
}

const text = (v, max = 60) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * The meter a reading comes from: one per meter id, whatever the driver or the
 * name the user gave it in wmbusmeters (both may change). `platformId` builds
 * the external ids, FOREVER.
 */
export function identify(telegram) {
  const id = idOf(telegram);
  const driver = text(telegram.driver ?? telegram.meter, 40);
  const label = text(telegram.name);
  const meter = `${driver} ${id}`;
  return {
    platformId: id,
    id,
    driver,
    media: text(telegram.media),
    label,
    name: label && label.toLowerCase() !== id ? `${label} (${meter})` : meter,
  };
}

/**
 * When wmbusmeters received the telegram (its `timestamp`, UTC), or undefined.
 * A retained message replayed by the broker can be hours old.
 */
export function receivedAt(telegram) {
  if (typeof telegram.timestamp !== 'string') {
    return undefined;
  }
  const at = Date.parse(telegram.timestamp);
  return Number.isFinite(at) ? at : undefined;
}

/** The radio signal level, when the dongle reports it (dBm), or undefined. */
export const rssiOf = (telegram) =>
  typeof telegram.rssi_dbm === 'number' && Number.isFinite(telegram.rssi_dbm)
    ? Math.round(telegram.rssi_dbm)
    : undefined;
