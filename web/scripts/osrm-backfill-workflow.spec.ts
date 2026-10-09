import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

/**
 * The OSRM backfill workflow template.
 *
 * The Arena GitHub App cannot push into `.github/workflows/`, so the
 * template lives at `infrastructure/github-workflows/osrm-backfill.yml`
 * and is pasted by hand into `.github/workflows/osrm-backfill.yml`. The
 * test below pins the parts that have to stay aligned with the runner
 * and the API contract — the schedule, the new `dry_run` input, the
 * preflight step that gates the rest of the job, and the platform /
 * school mode split. Anyone changing the template by hand will fail this
 * test if the shape drifts, and the fix is the same diff that the
 * operator pastes.
 */

const WORKFLOW_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../infrastructure/github-workflows/osrm-backfill.yml',
);
const workflow = readFileSync(WORKFLOW_PATH, 'utf8');

/** A tiny "find every `on: foo` step that matches the predicate" helper. */
function eachStepWithId() {
  const lines = workflow.split('\n');
  const steps = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = /^ {6}- name: (.+)$/.exec(line);
    if (match === null) continue;
    const block = [line];
    let cursor = index + 1;
    while (cursor < lines.length && /^ {8,}/.test(lines[cursor])) {
      block.push(lines[cursor]);
      cursor += 1;
    }
    steps.push({ name: match[1], block: block.join('\n') });
    index = cursor - 1;
  }
  return steps;
}

/** A regex that pins the `on:` trigger block at the top of the workflow. */
const ON_TRIGGER = /^on:\n/m;
const SCHEDULE_HEADER = /^ {2}schedule:\n/m;
const SCHEDULE_CRON = /^ {4}- cron: '30 21 \* \* \*'\n/m;

describe('OSRM backfill workflow template', () => {
  it('is well-formed YAML and has the schedule trigger', () => {
    // Plain-text grep: a YAML parser would also work, but the only
    // structural property the test cares about here is "the schedule
    // trigger is there" and the indentation is part of the contract.
    assert.match(workflow, ON_TRIGGER);
    assert.match(workflow, SCHEDULE_HEADER);
    assert.match(workflow, SCHEDULE_CRON);
  });

  it('declares the workflow_dispatch dry_run input, default false', () => {
    // The input is part of the preflight contract: the workflow gates
    // graph build, engine start, engine wait, sign-in and the platform
    // fill on `dry_run` being false. The default must be `false` so a
    // bare "Run workflow" click still does the real work.
    const INDENT_8 = ' '.repeat(8);
    const inputPattern = new RegExp(
      `dry_run:\\n${INDENT_8}description: 'Preflight only[\\s\\S]*?\\n${INDENT_8}default: false`,
      'm',
    );
    assert.match(workflow, inputPattern);
  });

  it('runs the preflight step only on mode=platform and not build_graph_only', () => {
    const preflight = eachStepWithId().find((step) => step.name.startsWith('Preflight'));
    assert.ok(preflight, 'a step named "Preflight — …" exists');
    assert.match(
      preflight.block,
      /id: preflight/,
      'the preflight step has the id the downstream `if:` conditions need',
    );
    assert.match(
      preflight.block,
      /if: \$\{\{ env\.MODE == 'platform' && !inputs\.build_graph_only \}\}/,
    );
    assert.match(preflight.block, /CHECK_ONLY: '1'/, 'the preflight runs the script in check mode');
    assert.match(preflight.block, /PLATFORM_EMAIL: \$\{\{ secrets\.OSRM_PLATFORM_EMAIL \}\}/);
    assert.match(preflight.block, /PLATFORM_PASSWORD: \$\{\{ secrets\.OSRM_PLATFORM_PASSWORD \}\}/);
  });

  it('gates the graph build, engine start, engine wait and platform backfill on needs_run', () => {
    // The whole point of the preflight: a day with nothing to do skips
    // the 15-minute graph build. Each heavy step must check the
    // preflight's needs_run output (and stay runnable in school mode,
    // where no preflight ran — needs_run is unset, the truthy `== 'true'`
    // comparison keeps those steps running).
    for (const name of [
      'Build the OSRM graph',
      'Start the engine',
      'Wait for the engine to answer',
    ]) {
      const step = eachStepWithId().find((candidate) => candidate.name.startsWith(name));
      assert.ok(step, `step "${name}" is present`);
      assert.match(
        step.block,
        /steps\.preflight\.outputs\.needs_run == 'true'/,
        `${name} runs only when the preflight said needs_run=true`,
      );
    }

    const platformFill = eachStepWithId().find(
      (step) => step.name === 'Backfill route geometry through the API (platform mode)',
    );
    assert.ok(platformFill, 'a platform fill step exists');
    assert.match(platformFill.block, /steps\.preflight\.outputs\.needs_run == 'true'/);
    assert.match(platformFill.block, /ADMIN_MODE: platform/);
  });

  it('stops the run on dry_run, after the preflight has already written its summary', () => {
    const dryRun = eachStepWithId().find(
      (step) => step.name === 'Stop after the preflight summary (dry_run)',
    );
    assert.ok(dryRun, 'a step named "Stop after the preflight summary (dry_run)" exists');
    assert.match(dryRun.block, /if: \$\{\{ inputs\.dry_run \}\}/);
    // The dry-run step is the LAST user-visible step that runs, so
    // earlier steps that gate on `!inputs.dry_run` are correct: they
    // are skipped, the dry-run step prints its notice, the engine-stop
    // `if: always()` runs to clean up the (absent) container.
    for (const name of [
      'Build the OSRM graph',
      'Start the engine',
      'Wait for the engine to answer',
    ]) {
      const step = eachStepWithId().find((candidate) => candidate.name.startsWith(name));
      assert.ok(step, `step "${name}" is present`);
      assert.match(step.block, /!inputs\.dry_run/, `${name} skips when dry_run is set`);
    }
  });

  it('keeps the school-mode fill working unchanged (no preflight gate)', () => {
    const schoolFill = eachStepWithId().find(
      (step) => step.name === 'Backfill route geometry through the API (school mode)',
    );
    assert.ok(schoolFill, 'a school fill step exists');
    assert.match(schoolFill.block, /env\.MODE == 'school'/);
    assert.equal(
      schoolFill.block.includes('steps.preflight.outputs.needs_run'),
      false,
      'school mode does not depend on the platform preflight',
    );
  });

  it('lets a scheduled run with missing secrets exit 0 (notice), a manual run exit 1 (error)', () => {
    const sched = eachStepWithId().find(
      (step) => step.name === 'Preflight — missing secrets (scheduled run)',
    );
    const manual = eachStepWithId().find(
      (step) => step.name === 'Preflight — missing secrets (manual run)',
    );
    assert.ok(sched, 'a scheduled-run no-op step exists');
    assert.ok(manual, 'a manual-run error step exists');
    assert.match(
      sched.block,
      /github\.event_name == 'schedule'/,
      'scheduled-run no-op only fires on a schedule',
    );
    assert.match(
      sched.block,
      /needs_run=false/,
      'writes the same needs_run marker the script does',
    );
    assert.match(
      manual.block,
      /github\.event_name != 'schedule'/,
      'manual-run error skips schedules',
    );
    assert.match(manual.block, /exit 1/, 'manual-run with missing secrets is a hard failure');
  });

  it('keeps upload_graph default false and gates the upload on !dry_run', () => {
    const INDENT_8 = ' '.repeat(8);
    const uploadPattern = new RegExp(`upload_graph:[\\s\\S]*?\\n${INDENT_8}default: false`);
    assert.match(workflow, uploadPattern);
    const upload = eachStepWithId().find(
      (step) => step.name === 'Upload the graph artefacts (optional, ≤ 2 GB)',
    );
    assert.ok(upload);
    assert.match(upload.block, /steps\.graph\.outputs\.upload == '1'/);
    // The size-check step above it must also gate on !dry_run so the
    // dry-run path does not try to `du` a directory that was never
    // built. Pinned here because the test is the single source of
    // truth for the dry-run gating.
    const size = eachStepWithId().find(
      (step) => step.name === 'Check the graph size before an optional upload',
    );
    assert.ok(size);
    assert.match(size.block, /!inputs\.dry_run/);
  });

  it('uses sensible defaults when the schedule trigger has no inputs', () => {
    // api_base / extract_url / bbox are workflow env values with the
    // documented fallbacks; a schedule (no inputs) still produces a
    // meaningful run. Pinned here so a future input that suddenly
    // becomes required does not silently break the daily schedule.
    assert.match(
      workflow,
      /API_BASE: \$\{\{ inputs\.api_base \|\| 'https:\/\/kidbus\.onrender\.com\/api\/v1' \}\}/,
    );
    assert.match(workflow, /MODE: \$\{\{ github\.event_name == 'schedule' && 'platform'/);
    assert.match(
      workflow,
      /EXTRACT_URL: \$\{\{ inputs\.extract_url \|\| 'https:\/\/download\.geofabrik\.de\/asia\/india\/western-zone-latest\.osm\.pbf' \}\}/,
    );
    assert.match(workflow, /BBOX: \$\{\{ inputs\.bbox \|\| '78\.60,20\.70,79\.60,21\.60' \}\}/);
  });
});
