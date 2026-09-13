const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Execute the shipped template, with only Cloudflare's host primitives replaced.
function runtime(timeout, options = {}) {
  const trace = [], jobs = [], values = new Map();
  const effects = timeout ? [{ type: 'cancel', decisionId: '1' }, { type: 'notify', id: 1 }, { type: 'notify', id: 2 }] : [{ type: 'notify', id: 1 }, { type: 'notify', id: 2 }];
  const adapter = {
    game: { createInitialState: () => ({}), handleCommand: () => ({ ok: true, state: { finished: true }, effects }), project: s => s },
    parseCreate: x => x, parseJoin: x => x, parseCommand: x => x, canConnect: () => true,
    executeEffect: async (effect, context) => {
      assert.equal(values.get('game-state').finished, true);
      assert.equal(context.sessionId, 'stable-session');
      assert.equal(context.env.TEST_BINDING, 'test');
      trace.push(`effect:${effect.id}`);
      if (options.deliveryFails) throw Error('network down');
    },
    ...(timeout ? { timeout: { effect: e => e.type === 'cancel' ? e : null, command: id => ({ type: 'timeout', id }) } } : {}),
  };
  const storage = {
    get: async k => values.get(k), put: async (k, v) => {
      if (options.saveFails) throw Error('disk failed');
      values.set(k, v); trace.push('save');
    }, delete: async k => values.delete(k), deleteAlarm: async () => trace.push('cancel'),
    setAlarm: async () => trace.push('alarm'), transaction: async fn => fn(storage),
  };
  const ctx = { id: { toString: () => 'stable-session' }, storage, waitUntil: p => jobs.push(p), blockConcurrencyWhile: fn => fn(), getWebSockets: () => [] };
  const source = fs.readFileSync(`templates/worker/${timeout ? 'timeout/' : ''}session.ts`, 'utf8').replace('__ADAPTER_IMPORT__', '"adapter"');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  const mockRequire = name => name === 'cloudflare:workers' ? { DurableObject: class { constructor(ctx, env) { this.ctx = ctx; this.env = env; } } } : name === 'adapter' ? { gameAdapter: adapter } : { isRecord: x => x && typeof x === 'object', parseCommandRequest: JSON.parse };
  new Function('require', 'exports', 'console', js)(mockRequire, exports, { error: () => trace.push('error') });
  return { instance: new exports.SessionDurableObject(ctx, { TEST_BINDING: 'test' }), trace, jobs, values };
}
for (const timeout of [false, true]) {
  test(`after-save effects: creation, isolated failure, remaining delivery (timeout=${timeout})`, async () => {
    const r = runtime(timeout, { deliveryFails: true });
    const response = await r.instance.fetch(new Request('https://local/create', { method: 'POST', headers: { 'x-actor-id': 'a' }, body: '{}' }));
    assert.equal(response.status, 200);
    await Promise.all(r.jobs);
    assert.deepEqual(r.trace, ['save', 'effect:1', 'error', 'effect:2', 'error']);
  });
  test(`save failure does not invoke effect (timeout=${timeout})`, async () => {
    const r = runtime(timeout, { saveFails: true });
    r.values.set('game-state', {});
    const responses = [];
    await r.instance.webSocketMessage({ deserializeAttachment: () => ({ actorId: 'a' }), send: x => responses.push(JSON.parse(x)) }, JSON.stringify({ requestId: '1', command: {} }));
    await Promise.all(r.jobs);
    assert.equal(responses[0].ok, false);
    assert.equal(r.trace.some(x => x.startsWith('effect:')), false);
    assert.deepEqual(r.values.get('game-state'), {});
  });
  test(`websocket success is preserved despite effect failure (timeout=${timeout})`, async () => {
    const r = runtime(timeout, { deliveryFails: true });
    r.values.set('game-state', {});
    const responses = [];
    await r.instance.webSocketMessage({ deserializeAttachment: () => ({ actorId: 'a' }), send: x => responses.push(JSON.parse(x)) }, JSON.stringify({ requestId: '1', command: {} }));
    await Promise.all(r.jobs);
    assert.deepEqual(responses.map(x => x.ok), [true]);
    assert.equal(r.values.get('game-state').finished, true);
  });
}
test('alarm commits state and consumes reservation before external delivery; repeated alarm does not redeliver', async () => {
  const r = runtime(true, { deliveryFails: true });
  r.values.set('game-state', {});
  r.values.set('decision-timeout', { decisionId: '1', deadline: 0 });
  await r.instance.alarm();
  await Promise.all(r.jobs);
  assert.deepEqual(r.trace, ['save', 'cancel', 'effect:1', 'error', 'effect:2', 'error']);
  assert.equal(r.values.has('decision-timeout'), false);
  await r.instance.alarm();
  assert.equal(r.trace.filter(x => x === 'effect:1').length, 1);
});
