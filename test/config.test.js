import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalizeConfig, normalizeTopic, parseServerUrl } from '../src/config.js';
import { METER_INTERVAL } from '../src/constants.js';

test('the broker address', () => {
  assert.deepEqual(parseServerUrl('192.168.1.10'), { url: 'mqtt://192.168.1.10' });
  assert.deepEqual(parseServerUrl(' mqtts://broker.lan:8883 '), { url: 'mqtts://broker.lan:8883' });
  assert.deepEqual(parseServerUrl('ws://10.0.0.2:9001/mqtt'), { url: 'ws://10.0.0.2:9001/mqtt' });
  assert.deepEqual(parseServerUrl(''), { error: 'empty' });
  assert.deepEqual(parseServerUrl('http://192.168.1.20'), { error: 'invalid' });
  assert.deepEqual(parseServerUrl('mqtt://'), { error: 'invalid' });
  assert.deepEqual(parseServerUrl('mqtt://u:p@host'), { error: 'credentials' });
});

test('the topic filter', () => {
  assert.equal(normalizeTopic('wmbusmeters/+'), 'wmbusmeters/+');
  assert.equal(normalizeTopic(' wmbusmeters/# '), 'wmbusmeters/#');
  assert.equal(normalizeTopic('#'), '#');
  for (const bad of ['', 'wmbusmeters/#/x', 'wmbusmeters/a+', 'meters#', null]) {
    assert.equal(normalizeTopic(bad), DEFAULTS.topic, String(bad));
  }
});

test('the configuration, normalized', () => {
  assert.deepEqual(normalizeConfig(), {
    url: undefined,
    urlError: 'empty',
    username: '',
    password: '',
    topic: 'wmbusmeters/#',
    verifyCertificate: true,
    meterInterval: METER_INTERVAL.default,
  });
  const c = normalizeConfig({
    server_url: '10.0.0.5',
    username: ' me ',
    password: ' s3cret ',
    topic: null,
    verify_certificate: false,
    meter_interval: '99999',
  });
  assert.equal(c.url, 'mqtt://10.0.0.5');
  assert.equal(c.username, 'me');
  assert.equal(c.password, ' s3cret ', 'a password is never trimmed');
  assert.equal(c.topic, 'wmbusmeters/#');
  assert.equal(c.verifyCertificate, false);
  assert.equal(c.meterInterval, METER_INTERVAL.max);
  assert.equal(normalizeConfig({ meter_interval: 'abc' }).meterInterval, 60);
  assert.equal(normalizeConfig({ meter_interval: -5 }).meterInterval, 0);
});
