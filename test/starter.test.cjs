const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const repo = path.resolve(__dirname, '..');
let root, mf, token, invalidToken;
const alice = '11111111-1111-4111-8111-111111111111';
const bob = '22222222-2222-4222-8222-222222222222';
const eve = '33333333-3333-4333-8333-333333333333';
const issuer = 'https://auth.starter.test';
before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-game-starter-'));
  fs.rmdirSync(root);
  execFileSync(process.execPath, [path.join(repo, 'bin/def-game.cjs'), 'init-worker', '--directory', root, '--name', 'starter-test']);
  fs.mkdirSync(path.join(root, 'node_modules/@cloudflare'), { recursive: true });
  for (const name of ['hono', 'jose', 'typescript', 'wrangler', '@cloudflare/workers-types']) {
    fs.symlinkSync(path.join(repo, 'node_modules', name), path.join(root, 'node_modules', name));
  }
  fs.symlinkSync(repo, path.join(root, 'node_modules/def-game'));
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', path.join(root, 'tsconfig.json')], { stdio: 'pipe' });
  const built = await build({ entryPoints: [path.join(root, 'src/index.ts')], bundle: true, write: false, format: 'esm',
    platform: 'browser', target: 'es2022', external: ['cloudflare:workers'] });
  const jose = await import('jose');
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
  const key = { ...await jose.exportJWK(publicKey), kid: 'test', use: 'sig', alg: 'ES256' };
  token = id => new jose.SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'test' }).setIssuer(issuer)
    .setAudience('waki.work').setSubject(id).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  invalidToken = await new jose.SignJWT({}).setProtectedHeader({ alg: 'ES256', kid: 'test' }).setIssuer(issuer)
    .setAudience('wrong').setSubject(alice).setIssuedAt().setExpirationTime('10m').sign(privateKey);
  mf = new Miniflare(convertV4MiniflareOptions({ name: 'starter', modules: true, script: built.outputFiles[0].text,
    compatibilityDate: '2026-09-12', durableObjects: { ROOMS: { className: 'RoomDurableObject', useSQLite: true } },
    bindings: { AUTH_ISSUER: issuer, AUTH_AUDIENCE: 'waki.work', AUTH_JWKS_URL: `${issuer}/.well-known/jwks.json` },
    serviceBindings: { ASSETS: async request => {
      const filename = new URL(request.url).pathname === '/app.js' ? 'app.js' : 'index.html';
      return new Response(fs.readFileSync(path.join(root, 'public', filename)), { headers: { 'Content-Type': filename.endsWith('.js') ? 'text/javascript' : 'text/html' } });
    } },
    outboundService: async request => {
      assert.equal(request.url, `${issuer}/.well-known/jwks.json`);
      return new Response(JSON.stringify({ keys: [key] }), { headers: { 'Content-Type': 'application/json' } });
    },
  }));
});
after(async () => { await mf?.dispose(); if (root) fs.rmSync(root, { recursive: true, force: true }); });
async function api(url, actor, body, extraHeaders = {}) {
  return mf.dispatchFetch(`https://starter.test${url}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { ...(actor ? { Cookie: `__token=${await token(actor)}` } : {}), 'Content-Type': 'application/json', ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function connect(roomId, actor) {
  const response = await api(`/ws/rooms/${roomId}`, actor, undefined, { Upgrade: 'websocket', Origin: 'https://starter.test' });
  assert.equal(response.status, 101);
  const ws = response.webSocket, messages = [];
  ws.addEventListener('message', event => messages.push(JSON.parse(event.data))); ws.accept();
  return { ws, messages, view: () => messages.filter(m => m.type === 'ViewStateEvent').at(-1)?.viewState };
}
async function until(fn) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) { const value = fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Timed out waiting for starter');
}
function send(socket, command, requestId) { socket.ws.send(JSON.stringify({ type: 'GameCommandRequest', requestId, command })); }

test('starter validates real JWT and request origin; static shell exposes no game state', async () => {
  assert.equal((await api('/api/rooms', undefined, {})).status, 401);
  assert.equal((await api('/api/rooms', undefined, {}, { Cookie: `__token=${invalidToken}` })).status, 401);
  assert.equal((await api('/api/rooms', alice, {}, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await api('/api/rooms', alice, { actorId: eve })).status, 201);
  assert.equal((await api('/api/rooms/not-a-room/join', alice, { name: 'Alice' })).status, 400);
  const shell = await api('/', undefined); assert.equal(shell.status, 200); assert.match(await shell.text(), /DefGame Starter/);
});

test('starter plays through HTTP external-data commands, WebSocket actions, private views and reconnect', async () => {
  const created = await (await api('/api/rooms', alice, {})).json(); assert.equal(created.ok, true);
  const id = created.roomId; assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal((await api(`/ws/rooms/${id}`, alice, undefined, { Upgrade: 'websocket' })).status, 403);
  assert.equal((await api(`/api/rooms/${id}/join`, alice, { name: 'Alice' })).status, 200);
  assert.equal((await api(`/api/rooms/${id}/join`, bob, { name: 'Bob' })).status, 200);
  assert.equal((await api(`/api/rooms/${id}/join`, eve, { name: 'Eve' })).status, 409);
  const a = await connect(id, alice), b = await connect(id, bob);
  await until(() => a.view() && b.view());
  // 本文の偽装deckを無視して、サーバー取得の値だけをCommandへ含める。
  await api(`/api/rooms/${id}/deck`, alice, { deckId: 'swift', deck: { cards: [{ id: 'cheat', power: 999 }] } });
  await api(`/api/rooms/${id}/deck`, bob, { deckId: 'steady' });
  await until(() => a.view().availableActions.includes('start') && b.view().yourCards.length);
  assert.deepEqual(a.view().yourCards.map(c => c.id), ['swift-1', 'swift-2']);
  assert.equal(JSON.stringify(a.view()).includes('steady-1'), false);
  send(a, { type: 'select-deck', deck: { cards: [{ id: 'cheat', power: 999 }] } }, 'cheat');
  await until(() => a.messages.some(m => m.type === 'ProtocolErrorEvent'));
  send(a, { type: 'start', now: 0 }, 'start');
  await until(() => a.view().phase === 'playing' && b.view().phase === 'playing');
  send(b, { type: 'play', cardId: 'steady-2', decisionId: b.view().decision.id }, 'out-of-turn');
  await until(() => b.messages.some(m => m.requestId === 'out-of-turn' && !m.ok));
  send(a, { type: 'play', cardId: 'swift-2', decisionId: a.view().decision.id }, 'play-a');
  await until(() => b.view().availableActions.includes('play'));
  send(b, { type: 'play', cardId: 'steady-2', decisionId: b.view().decision.id }, 'play-b');
  await until(() => a.view().phase === 'finished' && b.view().phase === 'finished');
  assert.deepEqual(a.view().players.map(p => p.score), [4, 5]);
  const again = await connect(id, alice); await until(() => again.view()); assert.equal(again.view().phase, 'finished');
  a.ws.close(); b.ws.close(); again.ws.close();
});

test('starter game timeout and ordinary play use the same state transition rules', async () => {
  const bundled = await build({ entryPoints: [path.join(root, 'src/game/definition.ts')], bundle: true, write: false, platform: 'node', format: 'cjs' });
  const Module = require('node:module'); const loaded = new Module('starter-game'); loaded._compile(bundled.outputFiles[0].text, 'starter-game.cjs');
  const { game } = loaded.exports; let state = game.createInitialState();
  const run = (command, context) => { const result = game.handleCommand(state, command, context); if (result.ok) state = result.state; return result; };
  for (const actorId of [alice, bob]) {
    run({ type: 'join', name: actorId }, { origin: 'actor', actorId });
  }
  // UUID表示名は上限を超えるため、ゲームの検証で拒否されている。
  assert.equal(state.players.length, 0);
  for (const [actorId, name] of [[alice, 'Alice'], [bob, 'Bob']]) {
    run({ type: 'join', name }, { origin: 'actor', actorId });
    run({ type: 'select-deck', deck: { id: 'one', name: 'One', cards: [{ id: 'card', power: 1 }] } }, { origin: 'actor', actorId });
  }
  run({ type: 'start', now: 100 }, { origin: 'actor', actorId: alice });
  assert.equal(run({ type: 'decision-timeout', decisionId: state.decision.id, now: 100 }, { origin: 'system' }).ok, false);
  const oldId = state.decision.id;
  assert.equal(run({ type: 'decision-timeout', decisionId: oldId, now: 30100 }, { origin: 'system' }).ok, true);
  assert.equal(state.turn, 1);
  assert.equal(run({ type: 'decision-timeout', decisionId: oldId, now: 99999 }, { origin: 'system' }).ok, false);
});
