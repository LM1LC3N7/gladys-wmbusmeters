import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevices, sortKeys } from '../src/devices.js';
import { identify } from '../src/telegrams.js';
import * as F from './fixtures/telegrams.js';

const meterOf = (t, keys) => ({ ...identify(t), keys: new Set(keys) });

test('one device per meter, its features in a stable order', async () => {
  const gladys = createFakeGladys();
  const [device] = buildDevices(gladys, [
    meterOf(F.KAMWATER_VADDEN, ['battery_low', 'status', 'alarm_leak', 'total_m3', 'target_m3']),
  ]);
  assert.equal(device.name, 'Vadden (kamwater 44556677)');
  assert.equal(device.external_id, 'ext:test-integration:wmbusmeters:44556677');
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    ['total_m3', 'target_m3', 'status', 'alarm_leak', 'battery_low'],
  );
  assert.deepEqual(device.params, [
    { name: 'meter_id', value: '44556677' },
    { name: 'driver', value: 'kamwater' },
    { name: 'manufacturer', value: 'Kamstrup' },
    { name: 'media', value: 'cold water' },
    { name: 'wmbusmeters_name', value: 'Vadden' },
  ]);
  assert.equal(device.should_poll, false);
  // The fake Gladys validates the devices like the host API does.
  await gladys.connect();
  await gladys.publishDiscoveredDevices([device]);
});

test('every real reading makes a device Gladys accepts', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const { readTelegram } = await import('../src/mapping.js');
  const meters = new Map();
  for (const t of F.ALL) {
    const { readings, status } = readTelegram(t);
    const keys = readings.map((r) => r.key);
    if (status) {
      keys.push('status', 'alarm_leak', 'battery_low');
    }
    meters.set(t.id, meterOf(t, keys));
  }
  const devices = buildDevices(gladys, [...meters.values()]);
  assert.equal(devices.length, meters.size);
  await gladys.publishDiscoveredDevices(devices);
  assert.equal(gladys.fake.discoveredDevices.length, meters.size);
});

test('a meter without any supported feature is not offered', () => {
  const gladys = createFakeGladys();
  assert.deepEqual(buildDevices(gladys, [meterOf(F.APATOR162_WASSER, ['unknown_field'])]), []);
});

test('the sort order', () => {
  assert.deepEqual(
    sortKeys([
      'rssi_dbm',
      'status',
      'flow_m3h',
      'total_energy_consumption_kwh',
      'total_volume_m3',
      'power_kw',
    ]),
    [
      'total_volume_m3',
      'total_energy_consumption_kwh',
      'power_kw',
      'flow_m3h',
      'status',
      'rssi_dbm',
    ],
  );
});
