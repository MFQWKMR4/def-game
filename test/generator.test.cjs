const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.resolve(__dirname, '../bin/def-game.cjs');
function fixture(t, patch = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'def-game-generator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/adapter.ts'), '// Game-owned file\n');
  const config = {
    outputDir: 'src/generated', adapter: 'src/adapter.ts', entry: 'src/index.ts',
    wranglerConfig: 'wrangler.jsonc', name: 'test-game', assets: 'public', compatibilityDate: '2026-09-12', ...patch,
  };
  fs.writeFileSync(path.join(root, 'worker.json'), JSON.stringify(config));
  const run = (...flags) => spawnSync(process.execPath, [cli, 'generate-worker', '--config', path.join(root, 'worker.json'), ...flags], { encoding: 'utf8', cwd: os.tmpdir() });
  return { root, run };
}

test('generates a relocatable Worker, preserves game files and regenerates deterministically', (t) => {
  const { root, run } = fixture(t);
  assert.equal(run('--check').status, 1);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Generated 8 files/);
  assert.match(fs.readFileSync(path.join(root, 'src/generated/index.ts'), 'utf8'), /from "\.\.\/adapter.js"/);
  assert.equal(fs.readFileSync(path.join(root, 'src/adapter.ts'), 'utf8'), '// Game-owned file\n');
  const wrangler = JSON.parse(fs.readFileSync(path.join(root, 'wrangler.jsonc'), 'utf8').split('\n').slice(1).join('\n'));
  assert.equal(wrangler.main, 'src/index.ts');
  assert.equal(wrangler.assets.run_worker_first, true);
  assert.deepEqual(wrangler.migrations, [{ tag: 'v1', new_sqlite_classes: ['SessionDurableObject'] }]);
  assert.match(run().stdout, /changed 0/);
  assert.equal(run('--check').status, 0);
});

test('preflights overwrite conflicts and repairs only requested output with force', (t) => {
  const { root, run } = fixture(t);
  const config = path.join(root, 'wrangler.jsonc');
  fs.writeFileSync(config, 'existing config');
  assert.equal(run().status, 1);
  assert.equal(fs.existsSync(path.join(root, 'src/generated')), false);
  assert.equal(fs.readFileSync(config, 'utf8'), 'existing config');
  assert.equal(run('--force').status, 0);
  const target = path.join(root, 'src/generated/session.ts');
  fs.appendFileSync(target, '\n// manual change\n');
  assert.equal(run('--check').status, 1);
  assert.match(fs.readFileSync(target, 'utf8'), /manual change/);
  assert.equal(run().status, 1);
  assert.equal(run('--force').status, 0);
  assert.equal(run('--check').status, 0);
});

test('rejects invalid config, output collisions, traversal and symlink outputs before writing', (t) => {
  for (const patch of [{ outputDir: '../escape' }, { entry: 'src/adapter.ts' }, { entry: 'src/generated/index.ts' },
    { assets: '/absolute' }, { name: 'bad name' }, { compatibilityDate: '2026-02-30' }, { timeout: "yes" }]) {
    const { root, run } = fixture(t, patch);
    assert.equal(run('--force').status, 1, JSON.stringify(patch));
    assert.equal(fs.existsSync(path.join(root, 'src/generated')), false);
    assert.equal(fs.readFileSync(path.join(root, 'src/adapter.ts'), 'utf8'), '// Game-owned file\n');
  }
  const { root, run } = fixture(t);
  fs.mkdirSync(path.join(root, 'other'));
  fs.symlinkSync(path.join(root, 'other'), path.join(root, 'src/generated'));
  assert.equal(run('--force').status, 1);
  assert.deepEqual(fs.readdirSync(path.join(root, 'other')), []);
});

test('validates CLI options', () => {
  for (const args of [['unknown'], ['generate-worker'], ['generate-worker', '--wat']]) {
    assert.equal(spawnSync(process.execPath, [cli, ...args]).status, 1);
  }
  assert.equal(spawnSync(process.execPath, [cli, '--help']).status, 0);
  assert.equal(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim(), require('../package.json').version);
});

test('timeout runtime is opt-in and reproducible', (t) => {
  const { root, run } = fixture(t, { timeout: true });
  assert.equal(run().status, 0);
  const session = fs.readFileSync(path.join(root, 'src/generated/session.ts'), 'utf8');
  assert.match(session, /async alarm/);
  assert.match(session, /txn.setAlarm/);
  assert.match(session, /origin: "system"/);
  assert.equal(run('--check').status, 0);
});
