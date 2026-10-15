// -----------------------------------------------------------------------------
// wmbusmeters fields -> Gladys features and values (pure).
//
// wmbusmeters names every field `<what>_<unit>` (total_m3, flow_temperature_c,
// current_power_consumption_kw...), in the same unit for every driver, and
// keeps the names of a driver stable across versions. A meter sends far more
// than a home needs (12 monthly histories, set dates, deltas): only an
// allow-list of fields becomes features, the feature key being the field
// name itself (its external id, forever).
//
// The status flags (`status`, `current_status`, the `current_alarms` of the
// old izar driver) become a text feature and binary alarms (leak, burst,
// dry, backflow, tamper, battery low). Which alarms a meter can raise comes
// from its driver (src/drivers.js), from the flag list wmbusmeters adds with
// `addtelegramdetails`, and from the flags seen.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DRIVERS } from './drivers.js';

// --- Values --------------------------------------------------------------------

/** A number, from a number or a numeric string. */
const num = (v) => {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const same = (v) => v;
const kiloToUnit = (v) => v * 1000;
const round3 = (v) => Math.round(v * 1000) / 1000;

// --- The features --------------------------------------------------------------

const feature = (name, category, type, unit, min, max, extra = {}) => ({
  name,
  category,
  type,
  unit,
  min,
  max,
  convert: same,
  ...extra,
});

const volume = (name) =>
  feature(name, C.VOLUME_SENSOR, T.VOLUME_SENSOR.DECIMAL, U.CUBIC_METER, 0, 1e9);
const energyIndex = (name) =>
  feature(name, C.ENERGY_SENSOR, T.ENERGY_SENSOR.INDEX, U.KILOWATT_HOUR, 0, 1e10);
const productionIndex = (name) =>
  feature(
    name,
    C.ENERGY_PRODUCTION_SENSOR,
    T.ENERGY_PRODUCTION_SENSOR.INDEX,
    U.KILOWATT_HOUR,
    0,
    1e10,
  );
const temperature = (name, type) => feature(name, C.TEMPERATURE_SENSOR, type, U.CELSIUS, -50, 200);

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** "t1_temperature_c" -> "T1 temperature". */
const humanize = (key) => capital(key.replace(/_[a-z0-9]+$/, '').replace(/_/g, ' '));

/** "total_heating_m3" -> "Heating volume", "total_cooling_energy_kwh" -> "Cooling energy". */
const named = (key, noun) => {
  const words = key
    .replace(/_[a-z0-9]+$/, '')
    .replace(/^total_/, '')
    .replace(/_/g, ' ');
  return capital(words.includes(noun) ? words : `${words} ${noun}`);
};
const phase = (key) => key.match(/[1-3]/)[0];

/** Names of the common fields; the others are made from the field name. */
const NAMES = {
  total_m3: 'Volume',
  total_volume_m3: 'Volume',
  total_backward_m3: 'Backward volume',
  total_backwards_m3: 'Backward volume',
  total_energy_consumption_kwh: 'Energy',
  total_kwh: 'Energy',
  total_energy_production_kwh: 'Energy production',
  flow_temperature_c: 'Flow temperature',
  return_temperature_c: 'Return temperature',
  supply_temperature_c: 'Supply temperature',
  external_temperature_c: 'External temperature',
};

/**
 * The allow-list: [field pattern, spec of the feature]. The first match wins.
 * Left out on purpose: histories and set-date values other than the billing
 * date, per-tariff and per-phase totals, maxima and averages, dates, texts.
 */
const RULES = [
  // Water, gas and heat-transfer volumes: the meter index and the other totals.
  [
    /^total_(?:[a-z0-9]+_)*m3$/,
    (k) => (/tariff|_at_|date/.test(k) ? undefined : volume(NAMES[k] ?? named(k, 'volume'))),
  ],
  [/^target_(?:volume_)?m3$/, () => volume('Volume at billing date')],
  // Energy indexes (heat and electricity meters).
  [
    /^total_(?:[a-z0-9]+_)*kwh$|^total_kwh$/,
    (k) =>
      /tariff|_at_|date|_l[1-3]_|phase/.test(k)
        ? undefined
        : /production/.test(k)
          ? productionIndex(NAMES[k] ?? named(k, 'energy'))
          : energyIndex(NAMES[k] ?? named(k, 'energy')),
  ],
  [
    /^target_(?:energy_)?(?:consumption_)?kwh$|^energy_at_set_date_kwh$/,
    () =>
      feature(
        'Energy at billing date',
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.ENERGY,
        U.KILOWATT_HOUR,
        0,
        1e10,
      ),
  ],
  // Power, in W like every Gladys power feature.
  [
    /^(?:current_power_consumption|power|active_consumption)_kw$/,
    () =>
      feature('Power', C.ENERGY_SENSOR, T.ENERGY_SENSOR.POWER, U.WATT, -1e7, 1e7, {
        convert: kiloToUnit,
      }),
  ],
  [
    /^current_power_production_kw$/,
    () =>
      feature(
        'Production power',
        C.ENERGY_PRODUCTION_SENSOR,
        T.ENERGY_PRODUCTION_SENSOR.POWER,
        U.WATT,
        0,
        1e7,
        {
          convert: kiloToUnit,
        },
      ),
  ],
  // Flow (negative when the water flows backwards): the only Gladys flow type.
  [
    /^(?:volume_|current_)?flow_m3h$/,
    () => feature('Flow', C.WATER_VALVE, T.WATER_VALVE.FLOW, U.CUBIC_METER_PER_HOUR, -1e4, 1e4),
  ],
  [
    /^max_flow_m3h$/,
    () => feature('Max flow', C.WATER_VALVE, T.WATER_VALVE.FLOW, U.CUBIC_METER_PER_HOUR, -1e4, 1e4),
  ],
  // Water temperatures measured by the meter: kept out of the room averages.
  [
    /^(?:flow|return|supply|forward|t[1-3]|external|water)_temperature_c$|^temperature_c$|^temp_radiator_c$/,
    (k) => temperature(NAMES[k] ?? humanize(k), T.TEMPERATURE_SENSOR.PROBE),
  ],
  // Room sensors.
  [
    /^(?:current_)?(?:room_)?temperature_c$|^temp_room_c$/,
    () => temperature('Temperature', T.SENSOR.DECIMAL),
  ],
  [
    /^(?:current_)?relative_humidity_rh$/,
    () => feature('Humidity', C.HUMIDITY_SENSOR, T.SENSOR.DECIMAL, U.PERCENT, 0, 100),
  ],
  // Electricity meters.
  [
    /^voltage_(?:at_phase_[1-3]|l[1-3]_n)_v$/,
    (k) =>
      feature(
        `Voltage phase ${phase(k)}`,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.VOLTAGE,
        U.VOLT,
        0,
        1e5,
      ),
  ],
  [
    /^current_(?:at_phase_[1-3]|l[1-3])_a$/,
    (k) =>
      feature(
        `Current phase ${phase(k)}`,
        C.ENERGY_SENSOR,
        T.ENERGY_SENSOR.CURRENT,
        U.AMPERE,
        0,
        1e5,
      ),
  ],
  // Heat cost allocators: units without a physical unit.
  [
    /^(?:current_consumption|consumption|current)_hca$/,
    () =>
      feature('Heat cost units', C.COUNTER_SENSOR, T.SENSOR.INTEGER, undefined, 0, 1e9, {
        convert: Math.round,
      }),
  ],
  [
    /^(?:consumption_at_set_date|target)_hca$/,
    () =>
      feature('Units at billing date', C.COUNTER_SENSOR, T.SENSOR.INTEGER, undefined, 0, 1e9, {
        convert: Math.round,
      }),
  ],
  // Battery.
  [
    /^battery_pct$/,
    () =>
      feature('Battery', C.BATTERY, T.BATTERY.INTEGER, U.PERCENT, 0, 100, { convert: Math.round }),
  ],
  [
    /^(?:remaining_battery_life|battery)_y$/,
    () => feature('Battery life', C.DURATION, T.DURATION.DECIMAL, U.YEARS, 0, 50),
  ],
  // The radio signal (dongles that report it): 5 bars from -110 to -40 dBm.
  [
    /^rssi_dbm$/,
    () =>
      feature('Signal', C.SIGNAL, T.SIGNAL.QUALITY, undefined, -110, -40, {
        convert: Math.round,
        clamp: true,
      }),
  ],
];

// --- Status and alarms ---------------------------------------------------------

/** The fields that carry flags, by priority (the first non-empty one is the status text). */
export const STATUS_FIELDS = ['status', 'current_status', 'current_alarms', 'error_flags'];

/** The feature keys of the status, never a wmbusmeters numeric field. */
export const STATUS_KEY = 'status';
export const ALARM_KEYS = {
  leak: 'alarm_leak',
  burst: 'alarm_burst',
  dry: 'alarm_dry',
  backflow: 'alarm_backflow',
  tamper: 'alarm_tamper',
  battery: 'battery_low',
};

/** Flag words -> alarm family. Flags about the past (PREV_..., ..._THIS_MONTH) are history. */
const FAMILIES = [
  ['leak', /LEAK/],
  ['burst', /BURST|BROKEN_PIPE/],
  ['dry', /(?:^|_)DRY(?:$|_)/],
  ['backflow', /REVERSE_FLOW|^REVERSE$|BACK_?FLOW|WRONG_FLOW_DIRECTION|NEGATIVE_FLOW/],
  ['tamper', /TAMPER|SABOTAGE|FRAUD|MANIPULATION|MAGNETIC|SEAL_BROKEN|REMOV|OPEN_COVER/],
  ['battery', /BATTERY|POWER_LOW/],
];
const HISTORY =
  /(?:^|_)(?:PREV|PREVIOUS|PAST|WAS|LAST)(?:_|$)|_(?:THIS|PREV)_MONTH$|_DATE$|HISTORIC/;
/** The words of a status that mean "nothing to report". */
const QUIET = /^(?:OK|NO_ALARM|NONE)$/;

/** The flag words of a status value: "ERROR POWER_LOW", "meter_blocked,underflow". */
export const wordsOf = (value) =>
  typeof value === 'string'
    ? value
        .split(/[\s,]+/)
        .map((w) => w.trim().toUpperCase())
        .filter((w) => w !== '' && !QUIET.test(w))
    : [];

/** The alarm families of flag words (history flags excluded). */
export function familiesOf(words) {
  const families = new Set();
  for (const word of words) {
    if (HISTORY.test(word)) {
      continue;
    }
    for (const [family, pattern] of FAMILIES) {
      if (pattern.test(word)) {
        families.add(family);
      }
    }
  }
  return families;
}

const ALARM_SPECS = {
  leak: ['Leak alarm', C.LEAK_SENSOR, T.SENSOR.BINARY],
  burst: ['Burst alarm', C.LEAK_SENSOR, T.SENSOR.BINARY],
  dry: ['Dry meter alarm', C.LEAK_SENSOR, T.SENSOR.BINARY],
  backflow: ['Backflow alarm', C.LEAK_SENSOR, T.SENSOR.BINARY],
  tamper: ['Tamper alarm', C.TAMPER, T.TAMPER.BINARY],
  battery: ['Battery low', C.BATTERY_LOW, T.BATTERY_LOW.BINARY],
};
const FAMILY_OF_KEY = Object.fromEntries(Object.entries(ALARM_KEYS).map(([f, k]) => [k, f]));

// --- Features ------------------------------------------------------------------

const ruleOf = (key) => {
  for (const [pattern, make] of RULES) {
    if (pattern.test(key)) {
      return make(key);
    }
  }
  return undefined;
};

/** The Gladys feature of a key (without its external_id), or undefined. */
export function featureSpec(key) {
  const common = { read_only: true, has_feedback: false };
  if (key === STATUS_KEY) {
    return {
      name: 'Status',
      category: C.TEXT,
      type: T.TEXT.TEXT,
      min: 0,
      max: 0,
      keep_history: true,
      ...common,
    };
  }
  const family = FAMILY_OF_KEY[key];
  if (family) {
    const [name, category, type] = ALARM_SPECS[family];
    return { name, category, type, min: 0, max: 1, keep_history: true, ...common };
  }
  const f = ruleOf(key);
  if (!f) {
    return undefined;
  }
  const spec = { name: f.name, category: f.category, type: f.type, min: f.min, max: f.max };
  if (f.unit) {
    spec.unit = f.unit;
  }
  return { ...spec, keep_history: true, ...common };
}

/** Measurements are throttled to the meter interval; the status and alarms never are. */
export const isThrottled = (key) => key !== STATUS_KEY && FAMILY_OF_KEY[key] === undefined;

/** A field value as the state of its feature (converted, bounded), or undefined. */
export function stateOf(key, raw) {
  const f = ruleOf(key);
  const n = num(raw);
  if (!f || n === undefined) {
    return undefined;
  }
  let v = f.convert(n);
  if (f.clamp) {
    v = Math.max(f.min, Math.min(f.max, v));
  }
  v = f.type === T.SENSOR.INTEGER || f.type === T.BATTERY.INTEGER ? Math.round(v) : round3(v);
  return v >= f.min && v <= f.max ? v : undefined;
}

// --- One reading ---------------------------------------------------------------

/** The flags wmbusmeters declares for this meter (`addtelegramdetails`), or []. */
function declaredFlags(telegram) {
  const fields = telegram.details?.fields;
  if (!fields || typeof fields !== 'object') {
    return [];
  }
  return STATUS_FIELDS.flatMap((f) =>
    Array.isArray(fields[f]?.flags) ? fields[f].flags.filter((w) => typeof w === 'string') : [],
  );
}

/** The alarm families a meter can raise, before any alarm: its driver's, and the declared flags. */
export function knownFamilies(telegram, driver) {
  const families = new Set(DRIVERS[driver]?.alarms ?? []);
  for (const family of familiesOf(declaredFlags(telegram).map((w) => w.toUpperCase()))) {
    families.add(family);
  }
  if (typeof telegram.status === 'string' && telegram.status.trim() !== '') {
    // The status of OMS meters includes the transport layer bits: POWER_LOW for all.
    families.add('battery');
  }
  return families;
}

/**
 * The readings of one wmbusmeters JSON.
 * @returns {{ readings: Array<{ key: string, state?: number, text?: string }>,
 *   status?: { text: string, words: string[], families: Set<string> } }}
 */
export function readTelegram(telegram) {
  const readings = [];
  for (const [key, raw] of Object.entries(telegram)) {
    if (key === STATUS_KEY || readings.length >= 64) {
      continue;
    }
    const state = stateOf(key, raw);
    if (state !== undefined) {
      readings.push({ key, state });
    }
  }
  const present = STATUS_FIELDS.filter((f) => typeof telegram[f] === 'string');
  if (present.length === 0) {
    return { readings };
  }
  const first = present.map((f) => telegram[f].trim()).find((v) => v !== '');
  const words = [...new Set(present.flatMap((f) => wordsOf(telegram[f])))];
  return {
    readings,
    status: {
      text: (first ?? 'OK').slice(0, 200),
      words,
      families: familiesOf(words),
    },
  };
}
