// A fake mqtt.js client: what the app subscribed to, and the broker side
// (connect, deliver a message, retained or not, fail).

import { EventEmitter } from 'node:events';

export class FakeMqttClient extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.connected = false;
    this.subscriptions = new Set();
    this.ended = false;
  }

  subscribe(topics, options, callback) {
    for (const topic of [].concat(topics)) {
      this.subscriptions.add(topic);
    }
    callback?.(null, []);
  }

  end() {
    this.ended = true;
    this.connected = false;
  }

  // --- The broker side ---
  open() {
    this.connected = true;
    this.emit('connect');
  }

  close() {
    this.connected = false;
    this.emit('close');
  }

  fail(err) {
    this.emit('error', err);
  }

  deliver(topic, payload, { retain = false } = {}) {
    const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
    this.emit('message', topic, Buffer.from(text), { topic, retain });
  }
}

/** A connect function for the app, keeping every client it creates. */
export function fakeConnector() {
  const clients = [];
  const connect = (config) => {
    const client = new FakeMqttClient(config);
    clients.push(client);
    return client;
  };
  return { clients, connect };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 10) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
