const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cli = path.resolve(__dirname, '../bin/def-game.cjs');
test('v6 initialization substitutes config and preserves app ownership', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-game-init-test-'));
  const target = path.join(root, 'app');
  const run = (...args) => spawnSync(process.execPath, [cli, 'init-worker', '--directory', target, '--name', 'my-game', ...args], { encoding: 'utf8' });
  try {
    assert.equal(run('--force').status, 1);
    assert.equal(fs.existsSync(target), false);
    assert.equal(run().status, 0);
    const pkg = JSON.parse(fs.readFileSync(path.join(target, 'package.json')));
    assert.equal(pkg.name, 'my-game');
    assert.equal(pkg.dependencies['def-game'], require('../package.json').version);
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'wrangler.jsonc'))).name, 'my-game');
    assert.ok(fs.existsSync(path.join(target, '.gitignore')));
    assert.match(fs.readFileSync(path.join(target, 'AGENTS.md'), 'utf8'), /design-philosophy/);
    fs.writeFileSync(path.join(target, 'src/index.ts'), 'app changes');
    assert.equal(run().status, 1);
    assert.equal(fs.readFileSync(path.join(target, 'src/index.ts'), 'utf8'), 'app changes');
    fs.rmSync(target, { recursive: true });
    fs.symlinkSync(path.join(root, 'missing'), target);
    assert.equal(run().status, 1);
    assert.equal(fs.existsSync(path.join(root, 'missing')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('local auth issues verifiable JWT and refreshes the same actor', async () => {
  const { startDevAuth } = await import('../templates/starter/scripts/dev-auth.mjs');
  const { jwtVerify, createLocalJWKSet } = await import('jose');
  const auth = await startDevAuth({ port: 0 });
  try {
    assert.equal((await fetch(`${auth.issuer}/refresh`)).status, 401);
    assert.equal((await fetch(`${auth.issuer}/login`, { headers: { Origin: 'https://evil.test' } })).status, 403);
    const response = await fetch(`${auth.issuer}/login?return_to=http://127.0.0.1:8787/?room=test`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
    const keys = createLocalJWKSet(await (await fetch(auth.jwksUrl)).json());
    const verify = async cookies => jwtVerify(cookies.match(/__token=([^;]+)/)[1], keys, { issuer: auth.issuer, audience: 'def-game-local' });
    const first = await verify(cookie);
    const refreshed = await fetch(`${auth.issuer}/refresh`, { headers: { Cookie: cookie } });
    assert.equal(refreshed.status, 204);
    assert.equal((await verify(refreshed.headers.getSetCookie().join('; '))).payload.sub, first.payload.sub);
  } finally { await auth.close(); }
});
