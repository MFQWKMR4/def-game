const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
let mf;
before(async () => {
  const result = await build({ entryPoints: ['test/fixtures/runtime/worker.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  mf = new Miniflare(convertV4MiniflareOptions({ workers: [{ name: 'runtime-test', modules: true, script: result.outputFiles[0].text, compatibilityDate: '2026-09-12',
    durableObjects: { ROOMS: { className: 'TestRoom', useSQLite: true } } }] }));
});
after(async () => { await mf?.dispose(); });
async function setup(name) {
  const ns = await mf.getDurableObjectNamespace('ROOMS');
  const stub = ns.get(ns.idFromName(name));
  const created = await stub.create();
  assert.equal(created.ok, true);
  await stub.dispatchActor({ actorId: 'alice' }, { type: 'join' });
  return stub;
}
async function post(room, command, path = '/command') {
  return (await mf.dispatchFetch(`https://test${path}?room=${room}`, { method: 'POST', body: JSON.stringify(command) })).json();
}
async function socket(room, actor = 'alice') {
  const response = await mf.dispatchFetch(`https://test/connect?room=${room}&actor=${actor}`, { headers: { upgrade: 'websocket' } });
  assert.equal(response.status, 101);
  const ws = response.webSocket;
  const messages = [];
  ws.addEventListener('message', e => messages.push(JSON.parse(e.data)));
  ws.accept();
  return { ws, messages };
}
async function until(fn) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Timed out waiting for runtime');
}

test('empty creation returns ID, refuses duplicates, join stays a command; helpers hide System entry', async () => {
  const ns = await mf.getDurableObjectNamespace('ROOMS'); const stub = ns.get(ns.idFromName('create'));
  const missing = await stub.dispatchActor({ actorId: 'a' }, { type: 'join' });
  assert.equal(missing.ok, false); assert.equal(missing.error.code, 'RoomNotFound');
  const result = await stub.create(); assert.equal(result.roomId, stub.id.toString());
  assert.equal((await stub.inspect()).state.members.length, 0);
  assert.equal((await stub.create()).error.code, 'RoomAlreadyExists');
  assert.deepEqual(await (await mf.dispatchFetch('https://test/keys')).json(), ['create', 'getView', 'dispatchActor', 'connect']);
  assert.equal((await stub.dispatchActor({ actorId: '' }, { type: 'join' })).error.code, 'InvalidRequest');
});

test('concurrent RPC commands preserve every update, reject spoofed origin', async () => {
  const stub = await setup('concurrent');
  await Promise.all(Array.from({ length: 25 }, () => stub.dispatchActor({ actorId: 'alice' }, { type: 'increment' })));
  assert.equal((await stub.inspect()).state.count, 25);
  const result = await stub.dispatchActor({ actorId: 'alice', origin: 'system' }, { type: 'result' });
  assert.equal(result.error.detail, 'system-only');
});

test('HTTP broadcasts actor-specific views to multiple sockets; reconnect gets latest, WS rejects trusted payloads', async () => {
  const stub = await setup('ws');
  await stub.dispatchActor({ actorId: 'bob' }, { type: 'join' });
  const a = await socket('ws'), a2 = await socket('ws'), b = await socket('ws', 'bob');
  await until(() => a.messages.length && a2.messages.length && b.messages.length);
  assert.equal(JSON.stringify(a.messages).includes('never-public'), false);
  assert.equal(b.messages[0].viewState.actorId, 'bob');
  assert.equal((await post('ws', { type: 'trusted', amount: 7 })).ok, true);
  await until(() => [a, a2, b].every(s => s.messages.some(m => m.viewState?.count === 7)));
  a.ws.send(JSON.stringify({ type: 'GameCommandRequest', requestId: 'bad', command: { type: 'trusted', amount: 1000 } }));
  await until(() => a.messages.some(m => m.type === 'ProtocolErrorEvent'));
  a.ws.send(JSON.stringify({ type: 'GameCommandRequest', requestId: 'inc', actorId: 'bob', origin: 'system', command: { type: 'increment' } }));
  await until(() => a.messages.some(m => m.requestId === 'inc' && m.ok));
  const reconnected = await socket('ws');
  await until(() => reconnected.messages.length);
  assert.equal(reconnected.messages[0].viewState.count, 8);
  assert.equal((await mf.dispatchFetch('https://test/connect?room=ws&actor=outsider', { headers: { upgrade: 'websocket' } })).status, 403);
  for (const s of [a, a2, b, reconnected]) s.ws.close();
});

test('effects run outside lock, feedback uses latest state and failures preserve original success', async () => {
  const stub = await setup('effect');
  assert.equal((await post('effect', { type: 'throw-effect' })).ok, true);
  await until(async () => (await stub.inspect()).entered);
  assert.equal((await post('effect', { type: 'increment' })).ok, true);
  assert.equal((await stub.inspect()).state.count, 2);
  await stub.releaseEffect();
  await until(async () => (await stub.inspect()).state.count === 12);
  assert.ok((await stub.inspect()).errors.includes('effect'));
});

test('scheduler persists multiple reservations and projects only the earliest physical alarm', async () => {
  const stub = await setup('alarm');
  const early = Date.now() + 60000, late = early + 60000, replacement = early - 10000;
  assert.equal((await post('alarm', { type: 'schedule', id: 'late', deadline: late })).ok, true);
  assert.equal((await post('alarm', { type: 'schedule', id: 'early', deadline: early })).ok, true);
  let snapshot = await stub.inspect();
  assert.deepEqual(snapshot.reservations, [{ id: 'late', deadline: late }, { id: 'early', deadline: early }]);
  assert.equal(snapshot.alarm, early);
  await stub.fireAlarm(); assert.equal((await stub.inspect()).state.count, 0);
  await post('alarm', { type: 'schedule', id: 'late', deadline: replacement });
  snapshot = await stub.inspect();
  assert.deepEqual(snapshot.reservations, [{ id: 'early', deadline: early }, { id: 'late', deadline: replacement }]);
  assert.equal(snapshot.alarm, replacement);
  await post('alarm', { type: 'cancel', id: 'old' }); assert.equal((await stub.inspect()).alarm, replacement);
  await post('alarm', { type: 'cancel', id: 'late' }); assert.equal((await stub.inspect()).alarm, early);
  assert.equal((await post('alarm', { type: 'invalid-alarm' })).ok, false);
  snapshot = await stub.inspect(); assert.equal(snapshot.state.count, 0);
  assert.deepEqual(snapshot.reservations, [{ id: 'early', deadline: early }]);
  await stub.expireReservations(); await stub.fireAlarm();
  snapshot = await stub.inspect(); assert.equal(snapshot.state.count, 10);
  assert.deepEqual(snapshot.state.fired, ['early']); assert.equal(snapshot.reservations, undefined); assert.equal(snapshot.alarm, null);
});

test('projection failure cannot turn committed success into failure or suppress external effects', async () => {
  const stub = await setup('projection'); const s = await socket('projection');
  await until(() => s.messages.length);
  assert.equal((await post('projection', { type: 'projection-error' })).ok, true);
  await until(async () => (await stub.inspect()).errors.includes('effect'));
  assert.equal((await stub.inspect()).state.count, -1);
  s.ws.close();
});


test('getView projects for non-members without connecting or changing state, reports failures', async () => {
  const ns = await mf.getDurableObjectNamespace('ROOMS');
  const stub = ns.get(ns.idFromName('read-view'));
  assert.equal((await stub.getView({ actorId: 'guest' })).error.code, 'RoomNotFound');
  await stub.create();
  const before = await stub.inspect();
  const response = await mf.dispatchFetch('https://test/view?room=read-view&actor=guest');
  assert.deepEqual(await response.json(), { ok: true, view: { count: 0, actorId: 'guest' } });
  const after = await stub.inspect();
  assert.equal(after.state.count, before.state.count);
  assert.equal(after.state.members.length, 0);
  assert.equal(after.alarm, before.alarm);
  assert.equal(after.reservations, before.reservations);
  assert.equal((await stub.getView({ actorId: '' })).error.code, 'InvalidRequest');
  await stub.dispatchActor({ actorId: 'alice' }, { type: 'join' });
  await stub.dispatchActor({ actorId: 'alice' }, { type: 'increment' });
  const latest = await stub.getView({ actorId: 'alice' });
  assert.equal(latest.ok, true);
  assert.equal(latest.view.count, 1);
  assert.equal(latest.view.actorId, 'alice');
  await stub.dispatchActor({ actorId: 'alice' }, { type: 'projection-error' });
  assert.equal((await stub.getView({ actorId: 'guest' })).error.code, 'InternalError');
  assert.equal((await stub.inspect()).state.count, -1);
});
