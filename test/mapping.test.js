import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DRIVERS } from '../src/drivers.js';
import {
  ALARM_KEYS,
  familiesOf,
  featureSpec,
  isThrottled,
  knownFamilies,
  readTelegram,
  wordsOf,
} from '../src/mapping.js';
import * as F from './fixtures/telegrams.js';

const values = (t) => Object.fromEntries(readTelegram(t).readings.map((r) => [r.key, r.state]));

test('a water meter: the index in m³, the flow, the battery life', () => {
  assert.deepEqual(values(F.HYDRUS_HYDRUSWATER), {
    flow_m3h: 0,
    flow_temperature_c: 10.4,
    remaining_battery_life_y: 13.687,
    target_m3: 0.2,
    total_m3: 1.174,
  });
  assert.deepEqual(featureSpec('total_m3'), {
    name: 'Volume',
    category: C.VOLUME_SENSOR,
    type: T.VOLUME_SENSOR.DECIMAL,
    min: 0,
    max: 1e9,
    unit: U.CUBIC_METER,
    keep_history: true,
    read_only: true,
    has_feedback: false,
  });
  assert.equal(featureSpec('target_m3').name, 'Volume at billing date');
  assert.equal(featureSpec('flow_m3h').unit, U.CUBIC_METER_PER_HOUR);
  assert.equal(featureSpec('flow_temperature_c').type, T.TEMPERATURE_SENSOR.PROBE);
  assert.equal(featureSpec('remaining_battery_life_y').unit, U.YEARS);
  assert.deepEqual(values(F.IPERL_WATERWATER), { max_flow_m3h: 0, total_m3: 123.529 });
  assert.equal(featureSpec('max_flow_m3h').name, 'Max flow');
});

test('the histories, dates and per-tariff totals are left out', () => {
  assert.deepEqual(Object.keys(values(F.EVO868_WASSER)), ['total_m3']);
  assert.deepEqual(Object.keys(values(F.HYDRODIGIT_HYDRODIGITWATER)), ['total_m3']);
  assert.deepEqual(Object.keys(values(F.QWATERV2_MYQWATER_2)).sort(), ['target_m3', 'total_m3']);
  assert.deepEqual(Object.keys(values(F.HYDRUS_HYDRUSAES)).sort(), [
    'external_temperature_c',
    'flow_m3h',
    'flow_temperature_c',
    'total_m3',
  ]);
});

test('a heat meter: energy index, power in W, flow and return temperatures', () => {
  assert.deepEqual(values(F.SHARKY774_DIEHL_METER), {
    energy_at_set_date_kwh: 44641,
    flow_temperature_c: 61.2,
    power_kw: 2634,
    return_temperature_c: 49.1,
    total_energy_consumption_kwh: 45110,
    total_volume_m3: 2353.809,
    volume_flow_m3h: 0.194,
  });
  assert.equal(featureSpec('total_energy_consumption_kwh').type, T.ENERGY_SENSOR.INDEX);
  assert.equal(featureSpec('energy_at_set_date_kwh').type, T.ENERGY_SENSOR.ENERGY);
  assert.deepEqual(
    [featureSpec('power_kw').unit, featureSpec('total_volume_m3').name],
    [U.WATT, 'Volume'],
  );
  // Heating and cooling of the same meter keep apart names.
  const h = readTelegram(F.HYDROCALM3_HEATCOOL).readings.map((r) => featureSpec(r.key).name);
  assert.deepEqual(h.sort(), [
    'Cooling energy',
    'Cooling volume',
    'Heating energy',
    'Heating volume',
    'Return temperature',
    'Supply temperature',
  ]);
});

test('an electricity meter: consumption and production indexes, power, phases', () => {
  assert.deepEqual(values(F.AMIPLUS_MYELECTRICITY2), {
    current_power_consumption_kw: 1055,
    current_power_production_kw: 0,
    total_energy_consumption_kwh: 9652.22,
    total_energy_production_kwh: 0,
    voltage_at_phase_1_v: 235,
    voltage_at_phase_2_v: 245,
    voltage_at_phase_3_v: 239,
  });
  assert.equal(featureSpec('total_energy_production_kwh').category, C.ENERGY_PRODUCTION_SENSOR);
  assert.equal(featureSpec('current_power_production_kw').category, C.ENERGY_PRODUCTION_SENSOR);
  assert.equal(featureSpec('voltage_at_phase_3_v').name, 'Voltage phase 3');
});

test('heat cost allocators, room sensors, gas', () => {
  assert.deepEqual(values(F.QCALORIC_MYELEMENT1), {
    consumption_at_set_date_hca: 145,
    current_consumption_hca: 127,
  });
  assert.equal(featureSpec('current_consumption_hca').category, C.COUNTER_SENSOR);
  assert.equal(featureSpec('current_consumption_hca').unit, undefined);
  assert.deepEqual(values(F.LANSENTH_TEMPOO), {
    current_relative_humidity_rh: 43,
    current_temperature_c: 21.8,
  });
  assert.equal(featureSpec('current_temperature_c').type, T.SENSOR.DECIMAL, 'a room temperature');
  assert.deepEqual(values(F.GWFGAS_MYGAS1), { target_m3: 0, total_m3: 101.886 });
});

test('implausible values are dropped, the signal is clamped', () => {
  // A disconnected probe of an Axioma Q400 reads -100 °C.
  assert.equal(values(F.Q400_MM).flow_temperature_c, undefined);
  assert.equal(values({ ...F.IPERL_WATERWATER, total_m3: -1 }).total_m3, undefined);
  assert.equal(values({ ...F.IPERL_WATERWATER, total_m3: '12.5' }).total_m3, 12.5);
  assert.equal(values({ ...F.IPERL_WATERWATER, total_m3: null }).total_m3, undefined);
  assert.equal(values({ ...F.IPERL_WATERWATER, rssi_dbm: -125 }).rssi_dbm, -110);
  assert.equal(values({ ...F.IPERL_WATERWATER, rssi_dbm: -61.6 }).rssi_dbm, -62);
  // A reverse flow is negative.
  assert.equal(values(F.TOPASESKR_WOTER).current_flow_m3h, -0.001);
});

test('every feature of every real reading is a valid Gladys feature', () => {
  const categories = new Set(Object.values(C));
  const types = new Set(Object.values(T).flatMap((t) => Object.values(t)));
  const units = new Set(Object.values(U));
  for (const t of F.ALL) {
    for (const { key } of readTelegram(t).readings) {
      const f = featureSpec(key);
      assert.ok(categories.has(f.category), `${key}: ${f.category}`);
      assert.ok(types.has(f.type), `${key}: ${f.type}`);
      assert.ok(f.unit === undefined || units.has(f.unit), `${key}: ${f.unit}`);
      assert.ok(f.name.length > 0 && f.name.length <= 100);
    }
  }
  for (const key of ['status', ...Object.values(ALARM_KEYS)]) {
    assert.ok(categories.has(featureSpec(key).category), key);
  }
});

test('the status flags: words and alarm families', () => {
  assert.deepEqual(wordsOf('ERROR POWER_LOW'), ['ERROR', 'POWER_LOW']);
  assert.deepEqual(wordsOf('meter_blocked,underflow'), ['METER_BLOCKED', 'UNDERFLOW']);
  assert.deepEqual(wordsOf('OK'), []);
  assert.deepEqual(wordsOf('no_alarm'), []);
  assert.deepEqual(wordsOf(''), []);
  const fam = (s) => [...familiesOf(wordsOf(s))].sort();
  assert.deepEqual(fam('DRY'), ['dry']);
  assert.deepEqual(fam('ALARM LEAK_FLOW_HIGH LEAK_FLOW_LOW'), ['leak']);
  assert.deepEqual(fam('BURST REVERSE LOW_BATTERY'), ['backflow', 'battery', 'burst']);
  assert.deepEqual(fam('leakage,back_flow,sensor_fraud'), ['backflow', 'leak', 'tamper']);
  assert.deepEqual(fam('PERMANENT_ERROR SABOTAGE_ENCLOSURE'), ['tamper']);
  // The past is history, not an alarm.
  assert.deepEqual(fam('NO_FLOW NO_FLOW_THIS_MONTH TAMPER_PREV_MONTH'), []);
  assert.deepEqual(fam('PREV_LEAKAGE WAS_LEAKING LEAK_DATE'), []);
});

test('a reading: the status text and the alarms raised now', () => {
  const dry = readTelegram(F.KAMWATER_MYTAPWATER).status;
  assert.equal(dry.text, 'DRY');
  assert.deepEqual([...dry.families], ['dry']);
  assert.equal(readTelegram(F.IPERL_WATERWATER_2).status.text, 'ERROR POWER_LOW');
  assert.deepEqual([...readTelegram(F.IPERL_WATERWATER_2).status.families], ['battery']);
  assert.equal(readTelegram(F.IZAR_IZARWATER).status.text, 'meter_blocked,underflow');
  // multical21: "current_status" is empty, "status" says OK.
  assert.equal(readTelegram(F.KAMWATER_VADDEN).status.text, 'OK');
  assert.equal(readTelegram(F.APATOR162_WASSER).status, undefined, 'no status field, no status');
});

test('the alarms a meter can raise, before the first one', () => {
  const fam = (t) => [...knownFamilies(t, t.driver)].sort();
  assert.deepEqual(fam(F.KAMWATER_VADDEN), [
    'backflow',
    'battery',
    'burst',
    'dry',
    'leak',
    'tamper',
  ]);
  assert.deepEqual(fam(F.IPERL_WATERWATER), ['battery']);
  assert.deepEqual(fam(F.IZARV2_IZARWATER2), ['backflow', 'battery', 'leak', 'tamper']);
  // An unknown driver: the flags wmbusmeters declares (addtelegramdetails) are enough.
  assert.deepEqual(fam({ ...F.KAMWATER_WITH_DETAILS, driver: 'newdriver' }), [
    'backflow',
    'battery',
    'burst',
    'dry',
    'leak',
    'tamper',
  ]);
  assert.deepEqual(fam({ ...F.IPERL_WITH_DETAILS, driver: 'newdriver' }), ['battery']);
});

test('the status and the alarms are never throttled', () => {
  assert.equal(isThrottled('total_m3'), true);
  assert.equal(isThrottled('status'), false);
  for (const key of Object.values(ALARM_KEYS)) {
    assert.equal(isThrottled(key), false, key);
  }
});

test('the driver table covers the meters common in France', () => {
  for (const driver of [
    'iperl',
    'hydrus',
    'izar',
    'izarv2',
    'multical21',
    'flowiq2200',
    'apator162',
    'itron',
    'sharky774',
    'mkradio3',
    'mkradio4',
    'qcaloric',
  ]) {
    assert.ok(DRIVERS[driver], driver);
  }
  const families = new Set(Object.keys(ALARM_KEYS));
  for (const [driver, entry] of Object.entries(DRIVERS)) {
    for (const family of entry.alarms ?? []) {
      assert.ok(families.has(family), `${driver}: ${family}`);
    }
  }
});
