'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

module.exports = function initWorker(args) {
  if (args.length === 1 && args[0] === '--help') {
    return console.log('Usage: def-game init-worker --directory <new-directory> --name <worker-name>');
  }
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('init-worker requires Node.js 22+');
  const options = {};
  while (args.length) {
    const key = args.shift();
    if (!['--directory', '--name'].includes(key) || options[key] || !args[0] || args[0].startsWith('--')) {
      throw new Error(`Unknown, repeated or incomplete option: ${key}`);
    }
    options[key] = args.shift();
  }
  if (!options['--directory'] || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(options['--name'] || '')) {
    throw new Error('Provide --directory and --name (1–63 lowercase letters, digits or hyphens)');
  }
  const target = path.resolve(options['--directory']);
  // Initial generation has no update/force mode: all output belongs to the app.
  if (fs.existsSync(target) || (() => { try { fs.lstatSync(target); return true; } catch { return false; } })()) {
    throw new Error(`Destination already exists: ${target}; choose a new directory`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(target), '.def-game-init-'));
  try {
    fs.cpSync(path.join(__dirname, '../templates/starter'), stage, { recursive: true });
    const packagePath = path.join(stage, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    pkg.name = options['--name'];
    pkg.dependencies['def-game'] = version;
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
    const configPath = path.join(stage, 'wrangler.jsonc');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config.name = options['--name'];
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
    fs.renameSync(path.join(stage, 'gitignore'), path.join(stage, '.gitignore'));
    // Reserve the destination exclusively before copying; never replace a racing writer.
    fs.mkdirSync(target);
    fs.cpSync(stage, target, { recursive: true, force: false, errorOnExist: true });
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
  console.log(`Created v6 starter at ${target}\nInstall dependencies, then run npm run dev. See README.md for local alpha installation.`);
};
