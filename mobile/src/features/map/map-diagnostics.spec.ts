import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_LOG_RECORDS,
  canRetryMap,
  clearMapIssue,
  getMapIssues,
  getMapLogRecords,
  recordMapLog,
  reportMapIssue,
  requestMapRetry,
  resetMapIssuesForTests,
  setMapRetryHandler,
  subscribeMapIssues,
} from './map-diagnostics.ts';

describe('map-diagnostics store', () => {
  beforeEach(() => {
    resetMapIssuesForTests();
  });

  it('collects distinct issues in report order and ignores duplicates', () => {
    reportMapIssue('glyphs');
    reportMapIssue('glyphs');
    reportMapIssue('styleLoad');
    reportMapIssue('glyphs');
    assert.deepEqual(getMapIssues(), ['glyphs', 'styleLoad']);
  });

  it('caps the remembered issues at 3', () => {
    // Only two codes exist today; the cap is contract, not current need.
    reportMapIssue('glyphs');
    reportMapIssue('styleLoad');
    reportMapIssue('glyphs');
    reportMapIssue('styleLoad');
    assert.ok(getMapIssues().length <= 3);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeMapIssues(() => {
      calls += 1;
    });
    reportMapIssue('styleLoad');
    assert.equal(calls, 1);
    reportMapIssue('styleLoad'); // duplicate — no change, no notify
    assert.equal(calls, 1);
    unsubscribe();
    reportMapIssue('glyphs');
    assert.equal(calls, 1);
    assert.deepEqual(getMapIssues(), ['styleLoad', 'glyphs']);
  });

  it('resets cleanly for tests', () => {
    reportMapIssue('glyphs');
    resetMapIssuesForTests();
    assert.deepEqual(getMapIssues(), []);
  });
});

describe('map-diagnostics recovery (R3)', () => {
  beforeEach(() => {
    resetMapIssuesForTests();
  });

  it('clears a reported issue, so recovery removes the line', () => {
    reportMapIssue('styleLoad');
    reportMapIssue('glyphs');
    clearMapIssue('styleLoad');
    assert.deepEqual(getMapIssues(), ['glyphs']);
  });

  it('notifies listeners on a real clear, and only on a real clear', () => {
    let calls = 0;
    const unsubscribe = subscribeMapIssues(() => {
      calls += 1;
    });
    reportMapIssue('styleLoad');
    assert.equal(calls, 1);
    clearMapIssue('glyphs'); // absent — no change, no notify
    assert.equal(calls, 1, 'clearing an absent code must not re-render the panels');
    clearMapIssue('styleLoad');
    assert.equal(calls, 2);
    assert.deepEqual(getMapIssues(), []);
    unsubscribe();
  });

  it('lets a cleared code be reported again — recovery is a cycle, not an archive', () => {
    reportMapIssue('styleLoad');
    clearMapIssue('styleLoad');
    reportMapIssue('styleLoad');
    reportMapIssue('glyphs');
    assert.deepEqual(getMapIssues(), ['styleLoad', 'glyphs'], 're-reported at the end');
  });

  it('frees a slot on clear, so a previously full store accepts a real issue again', () => {
    reportMapIssue('styleLoad');
    reportMapIssue('glyphs');
    clearMapIssue('styleLoad');
    // The cap stays reachable — a clear must genuinely free the slot.
    assert.equal(getMapIssues().length, 1);
    reportMapIssue('styleLoad');
    assert.deepEqual(getMapIssues(), ['glyphs', 'styleLoad']);
  });
});

/**
 * The evidence/verdict split, added with the "map failed to load with the
 * network on" fix: native log lines are *recorded* so a field screenshot can
 * name what failed, but they no longer *raise* an issue on their own.
 */
describe('map-diagnostics raw log records', () => {
  beforeEach(() => {
    resetMapIssuesForTests();
  });

  it('records a log line without raising an issue', () => {
    recordMapLog('styleLoad', 'Mbgl Failed to load style: timeout');
    assert.deepEqual(getMapIssues(), [], 'evidence is not a verdict');
    assert.equal(getMapLogRecords().length, 1);
    assert.equal(getMapLogRecords()[0].code, 'styleLoad');
    assert.match(getMapLogRecords()[0].text, /Failed to load style/);
  });

  it('collapses an identical line into a count rather than flooding', () => {
    recordMapLog('glyphs', 'Mbgl HTTP 404 /fonts/Noto/0-255.pbf');
    recordMapLog('glyphs', 'Mbgl HTTP 404 /fonts/Noto/0-255.pbf');
    recordMapLog('glyphs', 'Mbgl HTTP 404 /fonts/Noto/0-255.pbf');
    assert.equal(getMapLogRecords().length, 1);
    assert.equal(getMapLogRecords()[0].count, 3);
  });

  it('keeps only the most recent records', () => {
    for (let i = 0; i < MAX_LOG_RECORDS + 4; i += 1) {
      recordMapLog('styleLoad', `Mbgl failure number ${i}`);
    }
    const records = getMapLogRecords();
    assert.equal(records.length, MAX_LOG_RECORDS);
    assert.match(records[records.length - 1].text, new RegExp(`${MAX_LOG_RECORDS + 3}$`));
  });
});

describe('map-diagnostics retry affordance', () => {
  beforeEach(() => {
    resetMapIssuesForTests();
  });

  it('offers no retry until the style pipeline registers one', () => {
    assert.equal(canRetryMap(), false);
    // Safe to press a button that has nothing behind it.
    requestMapRetry();
  });

  it('routes a retry press to the registered handler', () => {
    let retries = 0;
    setMapRetryHandler(() => {
      retries += 1;
    });
    assert.equal(canRetryMap(), true);
    requestMapRetry();
    assert.equal(retries, 1);

    setMapRetryHandler(null);
    assert.equal(canRetryMap(), false);
    requestMapRetry();
    assert.equal(retries, 1, 'an unmounted map cannot be retried');
  });
});
