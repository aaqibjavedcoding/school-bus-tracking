#!/usr/bin/env node
/**
 * Mutation test for the Session 2 structural guards.
 *
 * Each entry breaks one rule on purpose and names the spec that must notice.
 * A guard that cannot fail is not a guard, so this script is the evidence that
 * the new filesystem assertions are load-bearing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Repo root, from this file's location — no absolute paths.
const MOBILE = resolve(dirname(fileURLToPath(import.meta.url)), '../mobile');

const CASES = [
  {
    name: 'observer freshness re-wired to the crew module',
    file: `${MOBILE}/src/features/map/tracking-presentation.ts`,
    find: "import { GPS_LIVE_WINDOW_MS, GPS_STALE_WINDOW_MS } from '@school-bus-tracking/shared-types';",
    replace:
      "import { SERVER_ACK_LIVE_WINDOW_MS as GPS_LIVE_WINDOW_MS, SERVER_ACK_STALE_WINDOW_MS as GPS_STALE_WINDOW_MS } from '../crew/tracking-status.ts';",
    spec: 'src/features/map/tracking-presentation.spec.ts',
  },
  {
    name: 'local-fix window collapsed into the shared window',
    file: `${MOBILE}/src/features/crew/tracking-status.ts`,
    find: 'export const LOCAL_FIX_FRESH_WINDOW_MS = 30_000;',
    replace: 'export const LOCAL_FIX_FRESH_WINDOW_MS = GPS_LIVE_WINDOW_MS;',
    spec: 'src/features/crew/tracking-status.spec.ts',
  },
  {
    name: 'follow pan given a zoom',
    file: `${MOBILE}/src/features/map/follow-camera-controller.ts`,
    find: 'deps.port.animateCamera(\n      { latitude: center.latitude, longitude: center.longitude },\n      { duration },\n    );',
    replace:
      'deps.port.animateCamera(\n      { latitude: center.latitude, longitude: center.longitude },\n      { duration, zoom: 15 },\n    );',
    spec: 'src/features/map/follow-camera-controller.spec.ts',
  },
  {
    name: 'zoom key always present on the camera call',
    file: `${MOBILE}/src/features/map/useFollowCamera.ts`,
    find: 'if (options.zoom !== undefined) camera.zoom = options.zoom;',
    replace: 'camera.zoom = options.zoom;',
    spec: 'src/features/map/bus-marker-invariants.spec.ts',
  },
  {
    name: 'driver map rolls its own camera',
    file: `${MOBILE}/src/features/crew/DriverTripMap.tsx`,
    find: '  } = useFollowCamera({',
    replace:
      '  } = useFollowCamera({\n    // MUTATION: direct reducer use, the duplication this guard forbids.\n    reduceFollowCamera,',
    spec: 'src/features/map/bus-marker-invariants.spec.ts',
  },
  {
    name: 'driver map claims the school sees the bus on a local fix',
    file: `${MOBILE}/src/features/crew/crew-map-presentation.ts`,
    find: "const schoolSeesLive = input.status === 'live';",
    replace: 'const schoolSeesLive = true;',
    spec: 'src/features/crew/crew-map-presentation.spec.ts',
  },
  {
    name: 'stale acknowledgement described as never delivered',
    file: `${MOBILE}/src/features/crew/crew-map-presentation.ts`,
    find: "    deliveryKey = 'driverMap.note.schoolStale';",
    replace: '    deliveryKey = null;', // the stale-ack sentence disappears
    spec: 'src/features/crew/crew-map-presentation.spec.ts',
  },
  {
    name: 'unavailable heading normalised into 359 again',
    file: `${MOBILE}/src/lib/geo.ts`,
    find: '  if (value < 0) return null;',
    replace: '  if (value < 0) return ((value % 360) + 360) % 360;',
    spec: 'src/lib/geo.spec.ts',
  },
];

let failures = 0;
for (const testCase of CASES) {
  const original = readFileSync(testCase.file, 'utf8');
  if (!original.includes(testCase.find)) {
    console.log(`SETUP-ERROR  ${testCase.name}: anchor not found in ${testCase.file}`);
    failures += 1;
    continue;
  }
  writeFileSync(testCase.file, original.replace(testCase.find, testCase.replace));
  let specFailed = false;
  let detail = '';
  try {
    execFileSync('node', ['--experimental-strip-types', '--test', testCase.spec], {
      cwd: MOBILE,
      stdio: 'pipe',
    });
  } catch (error) {
    specFailed = true;
    detail = String(error.stdout ?? '')
      .split('\n')
      .filter((line) => line.trim().startsWith('not ok'))
      .map((line) => line.trim())
      .slice(0, 2)
      .join(' | ');
  } finally {
    writeFileSync(testCase.file, original);
  }

  // The reverted tree must be green again, or the "pass" above was luck.
  let cleanPass = true;
  try {
    execFileSync('node', ['--experimental-strip-types', '--test', testCase.spec], {
      cwd: MOBILE,
      stdio: 'pipe',
    });
  } catch {
    cleanPass = false;
  }

  const caught = specFailed && cleanPass;
  if (!caught) failures += 1;
  console.log(
    `${caught ? 'CAUGHT     ' : 'NOT CAUGHT '} ${testCase.name}\n             ${testCase.spec}${detail ? `\n             ${detail}` : ''}${cleanPass ? '' : ' (spec did not pass after revert!)'}`,
  );
}

console.log(`\n${CASES.length - failures}/${CASES.length} mutations caught`);
process.exit(failures === 0 ? 0 : 1);
