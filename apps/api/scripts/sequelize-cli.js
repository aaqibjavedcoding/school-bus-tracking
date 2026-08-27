/**
 * Sequelize CLI runner.
 *
 * Registers `ts-node` (transpile-only, no type checking) so that the
 * TypeScript config, migrations and seeders can be executed by
 * `sequelize-cli`/Umzug without a separate build step. On Node >= 22 the
 * runtime strips types natively; registering ts-node keeps the commands
 * working on older Node versions as well.
 *
 * Usage (from the API workspace):
 *   node scripts/sequelize-cli.js db:migrate
 *   node scripts/sequelize-cli.js db:seed:all
 *
 * All command-line arguments are forwarded to the Sequelize CLI.
 */
'use strict';

require('ts-node/register/transpile-only');

const cliPath = require.resolve('sequelize-cli/lib/sequelize');

// The CLI reads `process.argv` directly; ensure only forwarded args remain.
process.argv = [process.argv[0], cliPath, ...process.argv.slice(2)];

require(cliPath);
