import { spawn } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { startDevAuth } from './dev-auth.mjs';

// CLIの--varはローカル実行だけに適用する。本番のWrangler設定を書き換えない。
const auth = await startDevAuth();
const require = createRequire(import.meta.url);
const worker = spawn(process.execPath, [path.join(path.dirname(require.resolve('wrangler/package.json')), 'bin/wrangler.js'), 'dev', '--local',
  '--ip', '127.0.0.1', '--port', '8787',
  '--var', `AUTH_ISSUER:${auth.issuer}`, '--var', 'AUTH_AUDIENCE:def-game-local', '--var', `AUTH_JWKS_URL:${auth.jwksUrl}`,
], { stdio: 'inherit' });
console.log('Open http://127.0.0.1:8787 — use another browser profile for the second player.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { worker.kill(signal); });
worker.once('error', async error => { console.error(error.message); await auth.close(); process.exitCode = 1; });
worker.once('exit', async code => { await auth.close(); process.exitCode = code ?? 0; });
