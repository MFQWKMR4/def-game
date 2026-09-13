const { test } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const Module = require('node:module');

// 永続化障害を確実に注入するためのテスト。通信・正常なtransactionは別途workerdで検証する。
async function harness() {
  const result = await build({ entryPoints: ['src/cloudflare/session-runtime.ts'], bundle: true, write: false,
    format: 'cjs', platform: 'node', target: 'es2022', plugins: [{ name: 'test-do', setup(build) {
      build.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: 'do', namespace: 'test' }));
      build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }' }));
    } }] });
  const loaded = new Module('runtime-test'); loaded._compile(result.outputFiles[0].text, 'runtime-test.cjs');
  let values = new Map(), alarm = null, failAlarm = false, effects = 0;
  const failures = [], pending = [], sockets = [];
  const storage = {
    get: async key => structuredClone(values.get(key)),
    setAlarm: async value => { alarm = value; },
    transaction: async fn => {
      const next = structuredClone(values); let nextAlarm = alarm;
      const txn = {
        get: async key => structuredClone(next.get(key)),
        put: async (key, value) => { next.set(key, structuredClone(value)); },
        delete: async key => { next.delete(key); },
        setAlarm: async value => { if (failAlarm) throw new Error('disk failure'); nextAlarm = value; },
        deleteAlarm: async () => { nextAlarm = null; },
      };
      const result = await fn(txn); values = next; alarm = nextAlarm; return result;
    },
  };
  const adapter = {
    game: {
      createInitialState: () => ({ count: 0 }),
      handleCommand: (state, command) => {
        if (command.type === 'reject') return { ok: false, error: 'stale-result' };
        return { ok: true, state: { count: state.count + 1 }, effects: command.type === 'schedule'
          ? [{ type: 'schedule', decisionId: 'd', deadline: Date.now() + 10000 }, { type: 'external' }]
          : command.type === 'feedback' ? [{ type: 'external' }] : [] };
      },
      project: state => state,
    },
    canConnect: () => true, webSocket: { parseCommand: x => x },
    timeout: { effect: e => e.type === 'schedule' ? e : null, command: () => ({ type: 'reject' }) },
    executeEffect: async () => { effects++; return { command: { type: 'reject' } }; },
    onError: failure => { failures.push(failure.phase); },
  };
  class Room extends loaded.exports.SessionRuntime { adapter = adapter; }
  const ctx = { storage, id: { toString: () => 'test-room' }, blockConcurrencyWhile: fn => fn(),
    getWebSockets: () => sockets, waitUntil: p => { pending.push(p); } };
  let room = new Room(ctx, {});
  return { room, storage, failures, pending, sockets, get effects() { return effects; },
    failAlarm: () => { failAlarm = true; }, get alarm() { return alarm; },
    restart: () => { room = new Room(ctx, {}); return room; } };
}

test('alarm write failure rolls back state and reservation, does not deliver effects', async () => {
  const h = await harness(); await h.room.create(); h.failAlarm();
  assert.equal((await h.room.dispatchActor({ actorId: 'a' }, { type: 'schedule' })).ok, false);
  assert.deepEqual(await h.storage.get('game-state'), { count: 0 });
  assert.equal(await h.storage.get('decision-timeout'), undefined);
  assert.equal(h.alarm, null); assert.equal(h.effects, 0);
});

test('rejected Alarm preserves reservation and throws for platform retry; rejected feedback reports failure', async () => {
  const h = await harness(); await h.room.create();
  await h.room.dispatchActor({ actorId: 'a' }, { type: 'schedule' });
  await Promise.all(h.pending);
  assert.ok(h.failures.includes('effect-feedback'));
  assert.deepEqual(await h.storage.get('game-state'), { count: 1 });
  await h.storage.transaction(txn => txn.put('decision-timeout', { decisionId: 'd', deadline: 0 }));
  await assert.rejects(() => h.room.alarm(), /Timeout command failed/);
  assert.equal((await h.storage.get('decision-timeout')).decisionId, 'd');
  assert.deepEqual(await h.storage.get('game-state'), { count: 1 });
});

test('new instance uses persisted state and socket attachment without constructor adapter access', async () => {
  const h = await harness(); await h.room.create();
  await h.room.dispatchActor({ actorId: 'a' }, { type: 'increment' });
  const messages = [];
  const socket = { deserializeAttachment: () => ({ actorId: 'a' }), send: raw => messages.push(JSON.parse(raw)), close() {} };
  h.sockets.push(socket);
  await h.restart().webSocketMessage(socket, JSON.stringify({ type: 'GameCommandRequest', requestId: 'after-restart', command: { type: 'increment' } }));
  assert.equal(messages.find(m => m.type === 'ViewStateEvent').viewState.count, 2);
  assert.equal(messages.find(m => m.requestId === 'after-restart').ok, true);
});
