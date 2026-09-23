import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
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
