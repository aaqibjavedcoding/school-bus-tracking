/**
 * Scaffold a new TypeScript migration with the Sequelize/Umzug naming
 * convention `<YYYYMMDDHHMMSS>-<kebab-name>.ts`.
 *
 * Why a custom script: `sequelize-cli` only emits `.js` skeletons, while this
 * project uses TypeScript migrations (loaded through ts-node by
 * `scripts/sequelize-cli.js`).
 *
 * Usage:
 *   node scripts/make-migration.js <migration-name>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const name = process.argv[2];

if (!name || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
  console.error('Usage: node scripts/make-migration.js <kebab-case-name>');
  process.exit(1);
}

const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const timestamp = [
  now.getUTCFullYear(),
  pad(now.getUTCMonth() + 1),
  pad(now.getUTCDate()),
  pad(now.getUTCHours()),
  pad(now.getUTCMinutes()),
  pad(now.getUTCSeconds()),
].join('');

const targetDir = path.resolve(__dirname, '..', 'src', 'database', 'migrations');
const targetFile = path.join(targetDir, `${timestamp}-${name}.ts`);
const templateFile = path.resolve(
  __dirname,
  '..',
  'src',
  'database',
  'templates',
  'migration-skeleton.ts',
);

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(templateFile, targetFile);

console.log(`New migration created at: ${path.relative(process.cwd(), targetFile)}`);
