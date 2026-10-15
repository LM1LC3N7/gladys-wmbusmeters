import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identify, parseTelegram, receivedAt, rssiOf } from '../src/telegrams.js';
import * as F from './fixtures/telegrams.js';

const json = (t) => Buffer.from(JSON.stringify(t));

test('every reading of the real wmbusmeters is one', () => {
  for (const t of F.ALL) {
    assert.ok(parseTelegram(json(t)), `${t.driver} ${t.id}`);
  }
  assert.ok(parseTelegram(json(F.IPERL_WITH_DETAILS)));
});

test('anything else on the topic is ignored', () => {
  for (const payload of [
    '',
    'online',
    'ALARM_DEVICE_FAILURE (im871a) dongle is gone', // an alarmshell text
    '{"broken"',
    '[1,2]',
    '{"_":"alarm","id":"12345678","driver":"iperl"}',
    '{"id":"12345678"}', // no driver
    '{"id":"not an id","driver":"iperl"}',
    JSON.stringify({ model: 'Nexus-TH', id: 201 }), // rtl_433
  ]) {
    assert.equal(parseTelegram(Buffer.from(payload)), null, payload);
  }
});

test('wmbusmeters 3.0 and older call the driver "meter"', () => {
  const old = {
    media: 'water',
    meter: 'iperl',
    name: 'MyTapWater',
    id: '33225544',
    total_m3: 123.529,
  };
  const t = parseTelegram(json(old));
  assert.ok(t);
  assert.equal(identify(t).driver, 'iperl');
});

test('one meter per id, named after the meter file', () => {
  assert.deepEqual(identify(F.IPERL_WATERWATER), {
    platformId: '33225544',
    id: '33225544',
    driver: 'iperl',
    media: 'water',
    label: 'WaterWater',
    name: 'WaterWater (iperl 33225544)',
  });
  // A name that is the id (id=* meter files often use it) is not repeated.
  assert.equal(identify({ ...F.IZARV2_IZARWATER, name: '21242472' }).name, 'izarv2 21242472');
  assert.equal(identify({ ...F.IZARV2_IZARWATER, name: undefined }).name, 'izarv2 21242472');
  // The driver changes (izar -> izarv2), the meter stays.
  assert.equal(identify(F.IZAR_IZARWATER).platformId, identify(F.IZARV2_IZARWATER).platformId);
});

test('the reception time and the signal', () => {
  assert.equal(receivedAt(F.IPERL_WATERWATER), Date.parse('2026-10-15T20:00:00Z'));
  assert.equal(receivedAt({ ...F.IPERL_WATERWATER, timestamp: 'never' }), undefined);
  assert.equal(rssiOf({ ...F.IPERL_WATERWATER, rssi_dbm: -62.4 }), -62);
  assert.equal(rssiOf(F.IPERL_WATERWATER), undefined);
});
