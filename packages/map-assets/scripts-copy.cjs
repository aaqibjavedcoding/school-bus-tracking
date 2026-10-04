/* eslint-disable @typescript-eslint/no-require-imports --
 * CommonJS tooling script, same exemption as web/scripts/**\/*.js: it runs
 * under plain node from the package build and needs require() for the
 * compiled dist output.
 */
/**
 * Ship the built styles where the web app serves them from.
 *
 * The styles live once, as typed objects, in `src/kidbus-*.ts`; this script
 * writes the compiled output (`dist/`) as the JSON files Next serves from
 * `web/public/map-styles/`, so the served file can never drift from the
 * imported object. Mobile imports the objects directly from the package and
 * never touches these files (see Session 5/6 in docs/live-tracking-map.md).
 */
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', '..', 'web', 'public', 'map-styles');
fs.mkdirSync(outDir, { recursive: true });

const { KIDBUS_DAY_STYLE } = require('./dist/kidbus-day.js');
const day = JSON.stringify(KIDBUS_DAY_STYLE, null, 2) + '\n';
fs.writeFileSync(path.join(outDir, 'kidbus-day.json'), day);

// Present since Session 6 (night mode). Guarded so the day build still
// succeeds on a checkout built before the night module existed.
try {
  const { KIDBUS_NIGHT_STYLE } = require('./dist/kidbus-night.js');
  const night = JSON.stringify(KIDBUS_NIGHT_STYLE, null, 2) + '\n';
  fs.writeFileSync(path.join(outDir, 'kidbus-night.json'), night);
} catch {
  // kidbus-night not in this build — nothing to ship.
}
