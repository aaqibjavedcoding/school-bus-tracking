import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearMapIssue,
  getMapIssues,
  reportMapIssue,
  resetMapIssuesForTests,
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
