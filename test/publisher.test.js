import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GladysApiError } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { StatePublisher } from '../src/publisher.js';

const silent = { warn() {}, info() {}, debug() {}, error() {} };
const ID = (key) => `ext:test-integration:wmbusmeters:33225544:${key}`;

async function setup({ budget, interval = 60, throttled = (id) => !id.endsWith('status') } = {}) {
  const gladys = createFakeGladys();
  await gladys.connect();
  let now = 1_000_000;
  const publisher = new StatePublisher({ gladys, logger: silent, now: () => now, budget });
  publisher.configure({ intervalSeconds: interval, isThrottled: throttled });
  return { gladys, publisher, advance: (ms) => (now += ms) };
}

test('the last value of a feature is sent, then spaced by the interval', async () => {
  const { gladys, publisher, advance } = await setup();
  publisher.push(ID('total_m3'), { state: 123.5 });
  publisher.push(ID('total_m3'), { state: 123.6 });
  assert.equal(await publisher.flush(), 1);
  assert.equal(gladys.fake.lastState(ID('total_m3')), 123.6);
  publisher.push(ID('total_m3'), { state: 123.7 });
  advance(30_000);
  assert.equal(await publisher.flush(), 0, 'within the interval: kept pending');
  advance(30_000);
  assert.equal(await publisher.flush(), 1);
  assert.equal(gladys.fake.lastState(ID('total_m3')), 123.7);
  publisher.push(ID('total_m3'), { state: 123.7 });
  advance(60_000);
  assert.equal(await publisher.flush(), 0, 'unchanged: not sent again');
});

test('a text state, never throttled', async () => {
  const { gladys, publisher } = await setup();
  publisher.push(ID('status'), { text: 'OK' });
  assert.equal(await publisher.flush(), 1);
  publisher.push(ID('status'), { text: 'LEAK' });
  assert.equal(await publisher.flush(), 1);
  const texts = gladys.fake.states.map((s) => s.text);
  assert.deepEqual(texts, ['OK', 'LEAK']);
});

test('the budget per minute', async () => {
  const { gladys, publisher, advance } = await setup({ budget: 2 });
  publisher.push(ID('a'), { state: 1 });
  publisher.push(ID('b'), { state: 2 });
  publisher.push(ID('c'), { state: 3 });
  assert.equal(await publisher.flush(), 2);
  assert.equal(await publisher.flush(), 0, 'budget spent');
  advance(60_000);
  assert.equal(await publisher.flush(), 1);
  assert.equal(gladys.fake.states.length, 3);
});

test('a refused request keeps the values for the next round', async (t) => {
  const { gladys, publisher } = await setup();
  const original = gladys.publishChangedStates.bind(gladys);
  let fail = true;
  t.mock.method(gladys, 'publishChangedStates', async (...args) => {
    if (fail) {
      throw new GladysApiError(429, 'TOO_MANY_REQUESTS', 'rate limited');
    }
    return original(...args);
  });
  publisher.push(ID('total_m3'), { state: 1 });
  await assert.rejects(publisher.flush(), /rate limited/);
  fail = false;
  assert.equal(await publisher.flush(), 1);
  assert.equal(gladys.fake.lastState(ID('total_m3')), 1);
});

test('a deleted device: its pending values are dropped', async () => {
  const { gladys, publisher } = await setup();
  publisher.push(ID('total_m3'), { state: 1 });
  publisher.push('ext:test-integration:wmbusmeters:44556677:total_m3', { state: 2 });
  publisher.forget('ext:test-integration:wmbusmeters:33225544');
  assert.equal(await publisher.flush(), 1);
  assert.deepEqual(
    gladys.fake.states.map((s) => s.device_feature_external_id),
    ['ext:test-integration:wmbusmeters:44556677:total_m3'],
  );
});
