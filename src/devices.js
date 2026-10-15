// -----------------------------------------------------------------------------
// The meters heard -> the Gladys devices of the Discovery tab (pure).
//
// A meter record (kept by the app) carries its identity and the feature keys
// of its readings: the fields it sends (a meter may alternate short and long
// telegrams), its status, and the alarms it can raise.
// -----------------------------------------------------------------------------

import { DEVICE_TYPE } from './constants.js';
import { DRIVERS } from './drivers.js';
import { ALARM_KEYS, STATUS_KEY, featureSpec } from './mapping.js';

/** Feature order on the device card: the index first, the diagnostics last. */
const ORDER = [
  /^total_m3$/,
  /^total_.*m3$/,
  /^target_.*m3$/,
  /kwh$/,
  /_kw$/,
  /m3h$/,
  /_c$/,
  /_rh$/,
  /_v$/,
  /_a$/,
  /^(?:current_consumption|consumption|current)_hca$/,
  /hca$/,
  new RegExp(`^${STATUS_KEY}$`),
  ...Object.values(ALARM_KEYS).map((k) => new RegExp(`^${k}$`)),
  /^battery_pct$/,
  /_y$/,
  /^rssi_dbm$/,
];

const rank = (key) => {
  const i = ORDER.findIndex((pattern) => pattern.test(key));
  return i >= 0 ? i : ORDER.length;
};

export const sortKeys = (keys) => [...keys].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

const param = (name, value) =>
  value === undefined || value === null || value === ''
    ? []
    : [{ name, value: String(value).slice(0, 100) }];

/** The external ids of a meter. */
export const idsOf = (gladys, meter) => gladys.externalIds(DEVICE_TYPE, meter.platformId);

/** One Gladys device per meter that has at least one supported feature. */
export function buildDevices(gladys, meters) {
  const devices = [];
  for (const meter of meters) {
    const ids = idsOf(gladys, meter);
    const features = [];
    for (const key of sortKeys(meter.keys)) {
      const spec = featureSpec(key);
      if (spec) {
        features.push({ ...spec, external_id: ids.feature(key) });
      }
    }
    if (features.length === 0) {
      continue;
    }
    devices.push({
      name: meter.name,
      external_id: ids.device,
      features,
      params: [
        ...param('meter_id', meter.id),
        ...param('driver', meter.driver),
        ...param('manufacturer', DRIVERS[meter.driver]?.manufacturer),
        ...param('media', meter.media),
        ...param('wmbusmeters_name', meter.label),
      ],
      should_poll: false,
    });
  }
  return devices.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}
