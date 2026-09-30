import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FAILURE_WINDOW_MS,
  GIVE_UP_AFTER_FAILURES,
  MAP_FAILED_MESSAGE,
  MAP_RETRYING_MESSAGE,
  SURFACE_AFTER_FAILURES,
  classifyMapErrorEvent,
  createMapErrorTracker,
  mapErrorCode,
} from './map-error-policy.ts';

/**
 * "Map failed to load" with the network ON — the lie this policy ends.
 *
 * MapLibre GL JS fires `error` for every 404 tile and every request the
 * browser aborts when the user pans. Wiring that straight to a red badge made
 * a perfectly working map — tiles drawn, bus moving — claim it had failed,
 * and nothing ever cleared it except a manual "Retry map".
 */

const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright';

const tileError = (sourceId = 'openmaptiles', status = 404) => ({
  sourceId,
  error: { message: `AJAXError: ${status}`, status, url: `${STYLE_URL}/tiles/12/2345/1234.pbf` },
});

const styleError = (message = 'Failed to fetch') => ({ error: { message } });

describe('classifyMapErrorEvent', () => {
  it('never calls a per-tile 404 a style failure', () => {
    assert.equal(classifyMapErrorEvent(tileError(), STYLE_URL), 'tile');
  });

  it('ignores a request aborted by a pan', () => {
    assert.equal(
      classifyMapErrorEvent({ error: { name: 'AbortError', message: 'The user aborted a request' } }),
      'ignore',
    );
    assert.equal(
      classifyMapErrorEvent({ sourceId: 'openmaptiles', error: { message: 'Request cancelled' } }),
      'ignore',
    );
  });

  it('ignores an event it cannot read at all', () => {
    assert.equal(classifyMapErrorEvent(null), 'ignore');
    assert.equal(classifyMapErrorEvent('boom'), 'ignore');
    assert.equal(classifyMapErrorEvent(undefined), 'ignore');
  });

  it('treats one missing glyph range or sprite as a sub-resource, not the style', () => {
    assert.equal(
      classifyMapErrorEvent({
        error: { message: 'Error loading glyph range 0-255', status: 404 },
      }),
      'tile',
    );
    assert.equal(
      classifyMapErrorEvent({ error: { message: 'Failed to load sprite', status: 404 } }),
      'tile',
    );
  });

  it('surfaces a style-level failure: no source, no sub-resource', () => {
    assert.equal(classifyMapErrorEvent(styleError(), STYLE_URL), 'style');
    assert.equal(
      classifyMapErrorEvent({ error: { message: 'WebGL context lost' } }, STYLE_URL),
      'style',
    );
    assert.equal(
      classifyMapErrorEvent({ error: { message: 'Unexpected token < in JSON' } }, STYLE_URL),
      'style',
    );
  });

  it('surfaces a request failure on the style URL even when a source is named', () => {
    assert.equal(
      classifyMapErrorEvent(
        { sourceId: 'openmaptiles', error: { message: 'AJAXError: 503', status: 503, url: STYLE_URL } },
        STYLE_URL,
      ),
      'style',
    );
    // …and the same URL with a cache-busting query is still the style.
    assert.equal(
      classifyMapErrorEvent(
        { error: { message: 'AJAXError: 500', status: 500, url: `${STYLE_URL}?v=2` } },
        STYLE_URL,
      ),
      'style',
    );
  });
});

describe('mapErrorCode (what a field screenshot can quote)', () => {
  it('names the HTTP status when there is one', () => {
    assert.equal(mapErrorCode(tileError('openmaptiles', 404), 'tile'), 'tile:404');
    assert.equal(mapErrorCode({ error: { status: 503 } }, 'style'), 'style:503');
  });

  it('names the source for a status-less tile error', () => {
    assert.equal(mapErrorCode({ sourceId: 'sbt-route' }, 'tile'), 'tile:sbt-route');
  });

  it('names the kind of style failure when there is no status', () => {
    assert.equal(mapErrorCode({ error: { message: 'WebGL context lost' } }, 'style'), 'style:webgl');
    assert.equal(
      mapErrorCode({ error: { message: 'Unexpected token < in JSON' } }, 'style'),
      'style:parse',
    );
    assert.equal(mapErrorCode({ error: { message: 'Failed to fetch' } }, 'style'), 'style:error');
  });
});

describe('the tracker: three consecutive failures in a short window', () => {
  it('says nothing at all for tile errors, however many', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    for (let i = 0; i < 20; i += 1) {
      const notice = tracker.record(tileError('openmaptiles', 404), 1_000 + i * 50);
      assert.equal(notice.kind, 'none', 'a 404 tile is never a user-visible error');
    }
    assert.equal(tracker.styleFailures(), 0);
  });

  it('stays quiet for the first two style failures and then softens, not screams', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    assert.equal(tracker.record(styleError(), 1_000).kind, 'none');
    assert.equal(tracker.record(styleError(), 2_000).kind, 'none');

    const third = tracker.record(styleError(), 3_000);
    assert.equal(third.kind, 'retrying');
    assert.equal(third.message, MAP_RETRYING_MESSAGE);
    assert.equal(SURFACE_AFTER_FAILURES, 3);
  });

  it('only says "Map failed to load" once the retry budget is spent', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    let notice = tracker.notice();
    for (let i = 0; i < GIVE_UP_AFTER_FAILURES; i += 1) {
      notice = tracker.record(styleError(), 1_000 + i * 1_000);
    }
    assert.equal(notice.kind, 'failed');
    assert.equal(notice.message, MAP_FAILED_MESSAGE);
  });

  it('forgets failures that fall out of the window — three blips over a trip are not an outage', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    assert.equal(tracker.record(styleError(), 0).kind, 'none');
    assert.equal(tracker.record(styleError(), FAILURE_WINDOW_MS + 1).kind, 'none');
    assert.equal(tracker.record(styleError(), 2 * FAILURE_WINDOW_MS + 2).kind, 'none');
    assert.equal(tracker.styleFailures(), 1);
  });

  it('clears automatically on a successful render — no restart, no tap', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    for (let i = 0; i < SURFACE_AFTER_FAILURES; i += 1) tracker.record(styleError(), 1_000 + i);
    assert.equal(tracker.notice().kind, 'retrying');

    const recovered = tracker.recover();

    assert.equal(recovered.kind, 'none');
    assert.equal(recovered.message, null);
    assert.equal(tracker.styleFailures(), 0);
    // …and the counter genuinely restarted, so one later blip stays quiet.
    assert.equal(tracker.record(styleError(), 9_000).kind, 'none');
  });

  it('recovers even from the terminal state (the network came back)', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    tracker.fail();
    assert.equal(tracker.notice().kind, 'failed');

    assert.equal(tracker.recover().kind, 'none');
    assert.equal(tracker.notice().kind, 'none');
  });

  it('is terminal immediately when the map could not be constructed', () => {
    const tracker = createMapErrorTracker();
    const notice = tracker.fail('style:init');
    assert.equal(notice.kind, 'failed');
    assert.equal(notice.message, MAP_FAILED_MESSAGE);
    assert.deepEqual(notice.codes, ['style:init']);
  });

  it('keeps the raw codes even for the errors it never shows', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    tracker.record(tileError('openmaptiles', 404), 1_000);
    tracker.record(tileError('openmaptiles', 503), 1_100);
    const notice = tracker.record(styleError(), 1_200);

    assert.equal(notice.kind, 'none', 'still nothing on screen');
    assert.deepEqual(notice.codes, ['tile:404', 'tile:503', 'style:error']);
  });

  it('collapses a repeating code instead of filling the line with it', () => {
    const tracker = createMapErrorTracker({ styleUrl: STYLE_URL });
    for (let i = 0; i < 30; i += 1) tracker.record(tileError('openmaptiles', 404), 1_000 + i);
    assert.deepEqual(tracker.notice().codes, ['tile:404']);
  });
});
