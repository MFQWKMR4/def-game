#!/usr/bin/env node
'use strict';
const { version } = require('../package.json');
function main(args) {
  if (!args.length || args[0] === '--help') {
    return console.log(`def-game ${version}
Usage: def-game init-worker --directory <new-directory> --name <worker-name>

Create an app-owned v6 starter. Existing directories are never overwritten.
Node.js 22+ is required.`);
  }
  if (args[0] === '--version') return console.log(version);
  if (args.shift() !== 'init-worker') throw new Error('Unknown command. Use --help.');
  return require('./init-worker.cjs')(args);
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(`def-game: ${error.message}`); process.exitCode = 1; }
