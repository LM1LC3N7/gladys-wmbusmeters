// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys, and a fake broker delivering the readings of the real wmbusmeters.
// Timers are mocked: the Discovery publication, the state flush and the
// transport checks run when the test ticks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WmbusApp } from '../src/app.js';
import { ACTIONS, LIMITS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import * as F from './fixtures/telegrams.js';
import { fakeConnector, settle } from './helpers/fakeMqtt.js';

const NOW = Date.parse('2026-10-15T20:00:30Z');
const PREFIX = 'ext:test-integration:wmbusmeters';
const IPERL = `${PREFIX}:33225544`;
const MULTICAL = `${PREFIX}:76348799`;

/** The reading as wmbusmeters would print it now (its timestamp has a 1 s resolution). */
const now = (t, offset = 0) => ({
  ...t,
  timestamp: new Date(Date.now() + offset).toISOString().replace(/\.\d+Z$/, 'Z'),
});

async function setup(t, config = { server_url: '192.168.1.10' }, devices = []) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: NOW });
  const gladys = createFakeGladys({ config, devices });
  const broker = fakeConnector();
  const logs = [];
  const logger = createLogger({ level: 'silent' });
  logger.warn = (m) => logs.push(m);
  const app = new WmbusApp({ gladys, connect: broker.connect, now: () => Date.now(), logger });
  registerHandlers(gladys, app);
  await gladys.connect();
  t.after(() => app.stop());
  const tick = async (ms) => {
    t.mock.timers.tick(ms);
    await settle();
  };
  const client = broker.clients[0];
  const hear = async (topic, ...telegrams) => {
    for (const telegram of telegrams) {
      client.deliver(topic, now(telegram));
    }
    await settle();
  };
  return { gladys, app, broker, client, tick, hear, logs };
}

/** Connects the broker, hears the readings, lets the Discovery publication run. */
async function discover(ctx, ...telegrams) {
  ctx.client.open();
  await settle();
  for (const telegram of telegrams) {
    await ctx.hear(`wmbusmeters/${telegram.id}`, telegram);
  }
  await ctx.tick(TIMINGS.publishDebounce);
}

const deviceOf = (gladys, id) =>
  gladys.fake.discoveredDevices.find((d) => d.external_id === `${PREFIX}:${id}`);
const keysOf = (device) => device.features.map((f) => f.external_id.split(':').pop());
const status = (gladys) => gladys.fake.connectionStatus.message.en;
const publications = (gladys) =>
  gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
const textOf = (gladys, id) =>
  gladys.fake.states.filter((s) => s.device_feature_external_id === id).at(-1)?.text;

test('the meters heard are offered in Discovery, values flow once created', async (t) => {
  const ctx = await setup(t);
  const { gladys, client } = ctx;
  assert.equal(client.config.url, 'mqtt://192.168.1.10');
  client.open();
  await settle();
  assert.deepEqual([...client.subscriptions], ['wmbusmeters/#']);
  assert.match(status(gladys), /Waiting for the first wmbusmeters reading on "wmbusmeters\/#"/);

  client.deliver('wmbusmeters_alarm', 'ALARM_DEVICE_FAILURE dongle lost'); // ignored
  await ctx.hear('wmbusmeters/33225544', F.IPERL_WATERWATER); // topic per id (the guide)
  await ctx.hear('wmbusmeters/Heato', F.SHARKY774_HEATO); // topic per name (the HA add-on)
  await ctx.tick(TIMINGS.publishDebounce);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Heato (sharky774 58496405)', 'WaterWater (iperl 33225544)'],
  );
  assert.deepEqual(keysOf(deviceOf(gladys, '33225544')), [
    'total_m3',
    'max_flow_m3h',
    'status',
    'battery_low',
  ]);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(status(gladys), /2 meters heard, 0 in Gladys/);

  // Before the device exists in Gladys, nothing is sent; its last values are kept.
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0);
  await gladys.fake.deviceCreated(deviceOf(gladys, '33225544'));
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${IPERL}:total_m3`), 123.529, 'the value heard before');
  assert.equal(textOf(gladys, `${IPERL}:status`), 'OK');
  assert.equal(gladys.fake.lastState(`${IPERL}:battery_low`), 0);

  // A chatty meter: a reading every 16 s, sent at the configured interval (60 s).
  await ctx.tick(16_000);
  await ctx.hear('wmbusmeters/33225544', { ...F.IPERL_WATERWATER, total_m3: 123.531 });
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${IPERL}:total_m3`), 123.529, 'waits for the interval');
  await ctx.tick(60_000);
  assert.equal(gladys.fake.lastState(`${IPERL}:total_m3`), 123.531);

  // The battery runs low: never delayed.
  await ctx.hear('wmbusmeters/33225544', F.IPERL_WATERWATER_2);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${IPERL}:battery_low`), 1);
  assert.equal(textOf(gladys, `${IPERL}:status`), 'ERROR POWER_LOW');
  assert.match(status(gladys), /2 meters heard, 1 in Gladys/);
});

test('the alarms of the driver are offered before the first alarm', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  // A multical21 that reports OK: every alarm it can raise is a feature already.
  const ok = { ...F.KAMWATER_MYTAPWATER, status: 'OK', current_status: '' };
  await discover(ctx, ok);
  const device = deviceOf(gladys, '76348799');
  assert.deepEqual(keysOf(device), [
    'total_m3',
    'target_m3',
    'status',
    'alarm_leak',
    'alarm_burst',
    'alarm_dry',
    'alarm_backflow',
    'alarm_tamper',
    'battery_low',
  ]);
  await gladys.fake.deviceCreated(device);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${MULTICAL}:alarm_dry`), 0);
  // The meter runs dry: the alarm is raised at once, then cleared.
  await ctx.tick(1000);
  await ctx.hear('wmbusmeters/76348799', F.KAMWATER_MYTAPWATER);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${MULTICAL}:alarm_dry`), 1);
  assert.equal(gladys.fake.lastState(`${MULTICAL}:alarm_leak`), 0);
  assert.equal(textOf(gladys, `${MULTICAL}:status`), 'DRY');
  await ctx.tick(1000);
  await ctx.hear('wmbusmeters/76348799', ok);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.lastState(`${MULTICAL}:alarm_dry`), 0);
});

test('an alarm of an unknown driver adds its feature when first seen', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  const meter = { ...F.PICOFLUX_MYWATER, driver: 'newdriver' };
  await discover(ctx, meter);
  assert.deepEqual(keysOf(deviceOf(gladys, '56544919')), [
    'total_m3',
    'total_backward_m3',
    'status',
    'battery_low',
  ]);
  await ctx.hear('wmbusmeters/56544919', { ...F.PICOFLUX_MYWATER_3, driver: 'newdriver' });
  await ctx.tick(TIMINGS.publishMinGap);
  assert.ok(keysOf(deviceOf(gladys, '56544919')).includes('alarm_leak'));
});

test('the Discovery list is published at most every 30 s', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  await discover(ctx, F.IPERL_WATERWATER);
  assert.equal(publications(gladys), 1);
  await ctx.tick(16_000);
  await ctx.hear('wmbusmeters/x', F.IPERL_WATERWATER);
  await ctx.tick(TIMINGS.publishMinGap);
  assert.equal(publications(gladys), 1, 'nothing new: nothing published');
  await ctx.hear('wmbusmeters/x', F.HYDRUS_HYDRUSWATER);
  await ctx.tick(TIMINGS.publishDebounce);
  assert.equal(publications(gladys), 2, 'the last one was long ago: published at once');
  await ctx.hear('wmbusmeters/x', F.SHARKY_HEAT);
  await ctx.tick(TIMINGS.publishDebounce);
  await ctx.hear('wmbusmeters/x', F.QCALORIC_MYELEMENT1);
  await ctx.tick(TIMINGS.publishDebounce);
  assert.equal(publications(gladys), 2, 'the new meters of the next 30 s wait...');
  await ctx.tick(TIMINGS.publishMinGap);
  assert.equal(publications(gladys), 3, '...and share one publication');
  assert.equal(gladys.fake.discoveredDevices.length, 4);
  // A scan from the Discovery screen publishes right away.
  await gladys.fake.scanRequest();
  assert.equal(publications(gladys), 4);
});

test('the same reading twice (two topics, a retained replay) counts once', async (t) => {
  const ctx = await setup(t);
  const { app, client } = ctx;
  client.open();
  await settle();
  const reading = now(F.IPERL_WATERWATER);
  client.deliver('wmbusmeters/33225544', reading);
  client.deliver('wmbusmeters/WaterWater', reading);
  client.deliver('wmbusmeters/33225544', reading, { retain: true });
  await settle();
  assert.equal(app.meters.get(IPERL).count, 1);
});

test('a retained reading is as old as its timestamp', async (t) => {
  const ctx = await setup(t, { server_url: '192.168.1.10' }, []);
  const { app, client, gladys } = ctx;
  client.open();
  await settle();
  // Published by wmbusmeters with -r 30 hours ago, replayed by the broker now.
  client.deliver('wmbusmeters/33225544', now(F.IPERL_WATERWATER, -30 * 3600_000), {
    retain: true,
  });
  await ctx.tick(TIMINGS.publishDebounce);
  assert.equal(app.meters.get(IPERL).lastSeen, NOW - 30 * 3600_000);
  const list = await gladys.fake.action(ACTIONS.LIST);
  assert.match(list.data.message.en, /last 30 h ago/);
});

test('an encrypted meter without its key: the list says what to do', async (t) => {
  const ctx = await setup(t);
  const { gladys, logs } = ctx;
  await discover(ctx, F.QWATERV2_KALTWASSER, F.IPERL_WATERWATER);
  assert.ok(logs.some((l) => /Kaltwasser.*no key.*MISSING_KEY/.test(l)));
  const list = (await gladys.fake.action(ACTIONS.LIST)).data.message;
  assert.match(
    list.en,
    /• Kaltwasser \(qwaterv2 14356101\): no value supported yet, status MISSING_KEY/,
  );
  assert.match(list.en, /encrypted and wmbusmeters has no key for it/);
  assert.match(list.fr, /chiffré et wmbusmeters n'a pas sa clé/);
  assert.match(
    list.en,
    /• WaterWater \(iperl 33225544\): volume 123\.529 m³, max flow 0 m³\/h, status OK\. 1 reading, last 2 s ago\./,
  );
  assert.match(
    list.fr,
    /volume 123,529 m³, débit max 0 m³\/h, état OK\. 1 relevé, dernier il y a 2 s\./,
  );
});

test('the transport badge: broker down, meter silent for a day', async (t) => {
  const created = { external_id: IPERL, features: [{ external_id: `${IPERL}:total_m3` }] };
  const ctx = await setup(t, { server_url: '192.168.1.10' }, [created]);
  const { gladys, client } = ctx;
  await discover(ctx, F.IPERL_WATERWATER);
  const badges = () => gladys.fake.transports.map((e) => [e.transport, e.degraded === true]);
  assert.deepEqual(badges().at(-1), [DEVICE_TRANSPORTS.LOCAL, false]);
  client.close();
  await settle();
  assert.deepEqual(badges().at(-1), [DEVICE_TRANSPORTS.UNREACHABLE, false]);
  assert.match(status(gladys), /unreachable: connection lost/);
  client.open();
  await settle();
  assert.deepEqual(badges().at(-1), [DEVICE_TRANSPORTS.LOCAL, false]);
  // Silent for 25 hours: still local (the broker works), but degraded with the reason.
  await ctx.tick(TIMINGS.staleAfter);
  const last = gladys.fake.transports.at(-1);
  assert.equal(last.degraded, true);
  assert.match(last.message.en, /No reading for 25 h/);
  assert.match(last.message.fr, /Aucun relevé depuis 25 h/);
  // Heard again: nominal.
  await ctx.hear('wmbusmeters/33225544', F.IPERL_WATERWATER);
  assert.deepEqual(badges().at(-1), [DEVICE_TRANSPORTS.LOCAL, false]);
});

test('the connection test waits for a first reading', async (t) => {
  const ctx = await setup(t);
  const { gladys, broker } = ctx;
  ctx.client.open();
  await settle();
  const pending = gladys.fake.action(ACTIONS.TEST);
  await settle();
  const probe = broker.clients[1];
  probe.open();
  await ctx.tick(3000);
  probe.deliver('wmbusmeters/33225544', now(F.IPERL_WATERWATER));
  const answer = (await pending).data.message;
  assert.match(
    answer.en,
    /Connection OK: wmbusmeters is publishing \(WaterWater \(iperl 33225544\), heard after 3 s\)/,
  );
  assert.equal(probe.ended, true);

  const silent = gladys.fake.action(ACTIONS.TEST);
  await settle();
  broker.clients[2].open();
  await ctx.tick(TIMINGS.testListen);
  assert.match(
    (await silent).data.message.en,
    /no wmbusmeters reading on "wmbusmeters\/#" in 30 s/,
  );

  const retained = gladys.fake.action(ACTIONS.TEST);
  await settle();
  broker.clients[3].open();
  broker.clients[3].deliver('wmbusmeters/x', now(F.HYDRUS_HYDRUSWATER, -2 * 3600_000), {
    retain: true,
  });
  assert.match((await retained).data.message.fr, /relevé conservé par le broker, d'il y a 2 h/);

  const refused = gladys.fake.action(ACTIONS.TEST);
  await settle();
  broker.clients[4].fail(Object.assign(new Error('Connection refused'), { code: 5 }));
  assert.match((await refused).data.message.en, /refused the connection: not authorized/);
});

test('not configured, or a bad address: said in the status', async (t) => {
  const ctx = await setup(t, {});
  assert.match(status(ctx.gladys), /Type the address of the MQTT broker/);
  assert.equal(ctx.broker.clients.length, 0);
  assert.match((await ctx.gladys.fake.action(ACTIONS.TEST)).data.message.en, /Type the address/);
  await ctx.gladys.fake.configUpdated({ server_url: 'mqtt://me:pw@broker' });
  assert.match(status(ctx.gladys), /user name and the password in their own fields/);
  await ctx.gladys.fake.configUpdated({ server_url: 'broker.lan', meter_interval: 0 });
  assert.equal(ctx.broker.clients.length, 1);
  assert.equal(ctx.broker.clients[0].config.url, 'mqtt://broker.lan');
});

test('a large message is ignored, the meters are bounded', async (t) => {
  const ctx = await setup(t);
  const { app, client, logs } = ctx;
  client.open();
  await settle();
  client.deliver('wmbusmeters/x', `{"x":"${'a'.repeat(LIMITS.payloadBytes)}"}`);
  await settle();
  assert.ok(logs.some((l) => /larger than/.test(l)));
  for (let i = 0; i < LIMITS.meters + 20; i += 1) {
    client.deliver('wmbusmeters/x', now({ ...F.APATOR162_WASSER, id: String(10_000_000 + i) }));
  }
  await settle();
  assert.equal(app.meters.size, LIMITS.meters);
});

test('a deleted device: nothing more is sent for it', async (t) => {
  const ctx = await setup(t);
  const { gladys } = ctx;
  await discover(ctx, F.IPERL_WATERWATER);
  const device = deviceOf(gladys, '33225544');
  await gladys.fake.deviceCreated(device);
  await gladys.fake.deviceDeleted(device);
  await ctx.tick(TIMINGS.flushInterval);
  assert.equal(gladys.fake.states.length, 0);
  assert.match(status(gladys), /1 meter heard, 0 in Gladys/);
});
