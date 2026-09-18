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
    deleteAlarm: async () => { alarm = null; },
    deleteAll: async () => { values.clear(); alarm = null; },
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
          ? [{ type: 'schedule', id: 'd', deadline: Date.now() + 10000 }, { type: 'external' }]
          : command.type === 'scheduled' && command.id === 'cancel-next' ? [{ type: 'cancel', id: 'next' }]
          : command.type === 'feedback' ? [{ type: 'external' }] : [] };
      },
      project: state => state,
    },
    canConnect: () => true, webSocket: { parseCommand: x => x },
    runtime: {
      effect: e => e.type === 'schedule' || e.type === 'cancel' ? e : null,
      scheduler: { command: id => id === 'reject' ? { type: 'reject' } : { type: 'scheduled', id } },
    },
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

test('alarm write failure rolls back state and scheduled events, does not deliver effects', async () => {
  const h = await harness(); await h.room.create(); h.failAlarm();
  assert.equal((await h.room.dispatchActor({ actorId: 'a' }, { type: 'schedule' })).ok, false);
  assert.deepEqual(await h.storage.get('game-state'), { count: 0 });
  assert.equal(await h.storage.get('scheduled-events'), undefined);
  assert.equal(h.alarm, null); assert.equal(h.effects, 0);
});

test('rejected Alarm preserves scheduled event and throws for platform retry; rejected feedback reports failure', async () => {
  const h = await harness(); await h.room.create();
  await h.room.dispatchActor({ actorId: 'a' }, { type: 'schedule' });
  await Promise.all(h.pending);
  assert.ok(h.failures.includes('effect-feedback'));
  assert.deepEqual(await h.storage.get('game-state'), { count: 1 });
  await h.storage.transaction(txn => txn.put('scheduled-events', [{ id: 'reject', deadline: 0 }]));
  await assert.rejects(() => h.room.alarm(), /Scheduled command failed/);
  assert.deepEqual(await h.storage.get('scheduled-events'), [{ id: 'reject', deadline: 0 }]);
  assert.deepEqual(await h.storage.get('game-state'), { count: 1 });
});

test('due scheduled events use latest state and can cancel later due events', async () => {
  const h = await harness(); await h.room.create();
  await h.storage.transaction(async txn => {
    await txn.put('scheduled-events', [{ id: 'first', deadline: 0 }, { id: 'second', deadline: 0 }]);
    await txn.setAlarm(0);
  });
  await h.room.alarm();
  assert.deepEqual(await h.storage.get('game-state'), { count: 2 });
  assert.equal(await h.storage.get('scheduled-events'), undefined);
  assert.equal(h.alarm, null);

  await h.storage.transaction(async txn => {
    await txn.put('scheduled-events', [{ id: 'cancel-next', deadline: 0 }, { id: 'next', deadline: 0 }]);
    await txn.setAlarm(0);
  });
  await h.room.alarm();
  assert.deepEqual(await h.storage.get('game-state'), { count: 3 });
  assert.equal(await h.storage.get('scheduled-events'), undefined);
  assert.equal(h.alarm, null);
});

test('new instance uses persisted state, scheduler, and socket attachment without constructor adapter access', async () => {
  const h = await harness(); await h.room.create();
  await h.room.dispatchActor({ actorId: 'a' }, { type: 'schedule' });
  assert.deepEqual((await h.storage.get('scheduled-events')).map(({ id }) => id), ['d']);
  assert.ok(h.alarm > Date.now());
  const messages = [];
  const socket = { deserializeAttachment: () => ({ actorId: 'a' }), send: raw => messages.push(JSON.parse(raw)), close() {} };
  h.sockets.push(socket);
  await h.restart().webSocketMessage(socket, JSON.stringify({ type: 'GameCommandRequest', requestId: 'after-restart', command: { type: 'increment' } }));
  assert.equal(messages.find(m => m.type === 'ViewStateEvent').viewState.count, 2);
  assert.equal(messages.find(m => m.requestId === 'after-restart').ok, true);
});
