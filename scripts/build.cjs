const { rmSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
rmSync('dist', { recursive: true, force: true });
for (const project of ['tsconfig.json', 'tsconfig.cloudflare.json']) {
  execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', project], { stdio: 'inherit' });
}
writeFileSync('dist/worker/package.json', JSON.stringify({ type: 'module' }) + '\n');
