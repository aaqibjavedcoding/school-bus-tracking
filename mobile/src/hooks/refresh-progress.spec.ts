import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createLoaderProgressTracker } from './refresh-progress.ts';

/**
 * Progress-flag tracking for the loader hooks (`useLoad`, `usePagedResource`).
 *
 * Regression coverage for the stuck "Refreshing…" top indicator: the
 * pull-to-refresh signal must be cleared by the pull's own completion, even
 * when a dependency-driven reload starts while the pull is in flight, and
 * never by the other signal. Data writes stay guarded by the shared
 * newest-operation sequence.
 */
describe('loader progress tracker', () => {
  it('a load that finishes as the newest load clears its own flag', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const id = t.startLoad();
    assert.equal(t.endLoad(id), true);
  });

  it('a superseded load does not clear the flag', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const first = t.startLoad();
    t.startLoad(); // newer load supersedes it
    assert.equal(t.endLoad(first), false);
  });

  it('a pull clears refreshing even when a reload started mid-pull (the stuck "Refreshing…" bug)', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const pull = t.startRefresh();
    t.startLoad(); // dependency-driven reload while the pull is in flight
    // The pull finishing must still clear the pull indicator — the intervening
    // load must not invalidate it.
    assert.equal(t.endRefresh(pull), true);
  });

  it('a pull never clears the loading flag and a load never clears refreshing', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const load = t.startLoad();
    const pull = t.startRefresh();
    assert.equal(t.endLoad(load), true); // loads own `loading`
    assert.equal(t.endRefresh(pull), true); // pulls own `refreshing`
  });

  it('a newer pull supersedes an older one', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const first = t.startRefresh();
    const second = t.startRefresh();
    assert.equal(t.endRefresh(first), false);
    assert.equal(t.endRefresh(second), true);
  });

  it('data writes go to the newest operation of either kind', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const load = t.startLoad();
    const pull = t.startRefresh(); // newer than the load
    assert.equal(t.canWriteData(load), false);
    assert.equal(t.canWriteData(pull), true);

    const reload = t.startLoad(); // newest of all
    assert.equal(t.canWriteData(pull), false);
    assert.equal(t.canWriteData(reload), true);
  });

  it('unmount drops every update (no writes, no flag changes after teardown)', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    const load = t.startLoad();
    const pull = t.startRefresh();
    t.unmount();
    assert.equal(t.canWriteData(pull), false);
    assert.equal(t.endLoad(load), null);
    assert.equal(t.endRefresh(pull), null);
  });

  it('remount after teardown (StrictMode double effect) re-enables updates', () => {
    const t = createLoaderProgressTracker();
    t.mount();
    t.unmount();
    t.mount();
    const id = t.startLoad();
    assert.equal(t.canWriteData(id), true);
    assert.equal(t.endLoad(id), true);
  });
});
