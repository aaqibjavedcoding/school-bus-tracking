import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  INITIAL_MAP_ERROR_STATE,
  MAP_ERROR_GIVE_UP_THRESHOLD,
  MAP_ERROR_THRESHOLD,
  MAP_ERROR_WINDOW_MS,
  MAP_FAILED_MESSAGE,
  MAP_RETRYING_MESSAGE,
  classifyMapErrorEvent,
  clearMapError,
  describeMapError,
  mapNoticeMessage,
  recordMapError,
  type MapErrorState,
} from './map-error-policy.ts';

const STYLE_URL = 'https://tiles.example.org/styles/streets/style.json';

function feed(
  state: MapErrorState,
  event: unknown,
  at: number,
  styleUrl: string | null = STYLE_URL,
): MapErrorState {
  return recordMapError(state, classifyMapErrorEvent(event, styleUrl), at);
}

describe('classifyMapErrorEvent', () => {
  it('reads a per-tile 404 as a source error, not a style failure', () => {
    const kind = classifyMapErrorEvent(
      {
        sourceId: 'openmaptiles',
        error: { message: 'Not Found', status: 404, url: 'https://tiles.example.org/9/12/34.pbf' },
      },
      STYLE_URL,
    );
    assert.equal(kind, 'source');
  });

  it('reads a request cancelled by a pan as an abort', () => {
    assert.equal(
      classifyMapErrorEvent({ sourceId: 'openmaptiles', error: { name: 'AbortError' } }, STYLE_URL),
      'abort',
    );
    assert.equal(
      classifyMapErrorEvent({ error: { message: 'The operation was aborted.' } }, STYLE_URL),
      'abort',
    );
  });

  it('reads an error with no sourceId as style-level', () => {
    assert.equal(
      classifyMapErrorEvent({ error: { message: 'Failed to fetch' } }, STYLE_URL),
      'style',
    );
  });

  it('reads a failure against the style document itself as style-level even with a sourceId', () => {
    assert.equal(
      classifyMapErrorEvent(
        { sourceId: 'openmaptiles', error: { status: 503, url: STYLE_URL } },
        STYLE_URL,
      ),
      'style',
    );
  });

  it('reads WebGL context loss as fatal', () => {
    assert.equal(
      classifyMapErrorEvent({ error: { message: 'WebGL context lost' } }, STYLE_URL),
      'fatal',
    );
  });
});

describe('recordMapError', () => {
  it('never surfaces anything for a single 404 tile', () => {
    const state = feed(INITIAL_MAP_ERROR_STATE, {
      sourceId: 'openmaptiles',
      error: { status: 404, url: 'https://tiles.example.org/9/12/34.pbf' },
    }, 1_000);

    assert.equal(state.notice, 'none');
    assert.equal(mapNoticeMessage(state.notice), null);
  });

  it('never surfaces anything for a storm of tile 404s and aborts', () => {
    let state = INITIAL_MAP_ERROR_STATE;
    for (let i = 0; i < 40; i += 1) {
      state = feed(state, {
        sourceId: 'openmaptiles',
        error: { status: 404, url: `https://tiles.example.org/9/${i}/34.pbf` },
      }, 1_000 + i * 20);
      state = feed(state, { sourceId: 'openmaptiles', error: { name: 'AbortError' } }, 1_010 + i * 20);
    }
    assert.equal(state.notice, 'none');
  });

  it('stays quiet until three consecutive style failures in a short window', () => {
    let state = INITIAL_MAP_ERROR_STATE;
    state = feed(state, { error: { message: 'Failed to fetch' } }, 1_000);
    assert.equal(state.notice, 'none');
    state = feed(state, { error: { message: 'Failed to fetch' } }, 1_500);
    assert.equal(state.notice, 'none', 'two is still not enough');
    state = feed(state, { error: { message: 'Failed to fetch' } }, 2_000);
    assert.equal(state.notice, 'retrying');
    assert.equal(mapNoticeMessage(state.notice), MAP_RETRYING_MESSAGE);
  });

  it('forgets failures that fall out of the window', () => {
    let state = INITIAL_MAP_ERROR_STATE;
    state = feed(state, { error: { message: 'Failed to fetch' } }, 0);
    state = feed(state, { error: { message: 'Failed to fetch' } }, MAP_ERROR_WINDOW_MS + 1);
    state = feed(state, { error: { message: 'Failed to fetch' } }, MAP_ERROR_WINDOW_MS + 2);

    assert.equal(state.failures.length, 2, 'the first failure aged out');
    assert.equal(state.notice, 'none');
  });

  it('softens the copy while retrying and hardens it only once it gives up', () => {
    let state = INITIAL_MAP_ERROR_STATE;
    for (let i = 0; i < MAP_ERROR_THRESHOLD; i += 1) {
      state = feed(state, { error: { message: 'Failed to fetch' } }, 100 * i);
    }
    assert.equal(mapNoticeMessage(state.notice), MAP_RETRYING_MESSAGE);

    for (let i = MAP_ERROR_THRESHOLD; i < MAP_ERROR_GIVE_UP_THRESHOLD; i += 1) {
      state = feed(state, { error: { message: 'Failed to fetch' } }, 100 * i);
    }
    assert.equal(mapNoticeMessage(state.notice), MAP_FAILED_MESSAGE);
  });

  it('surfaces a fatal event immediately — there is nothing to retry', () => {
    const state = recordMapError(INITIAL_MAP_ERROR_STATE, 'fatal', 0);
    assert.equal(mapNoticeMessage(state.notice), MAP_FAILED_MESSAGE);
  });
});

describe('clearMapError', () => {
  it('clears the notice when the map draws again, with no user action', () => {
    let state = INITIAL_MAP_ERROR_STATE;
    for (let i = 0; i < MAP_ERROR_GIVE_UP_THRESHOLD; i += 1) {
      state = feed(state, { error: { message: 'Failed to fetch' } }, 100 * i);
    }
    assert.equal(state.notice, 'failed');

    // A `styledata` with a loaded style, or an `idle`: the map is drawing.
    const recovered = clearMapError(state);
    assert.equal(recovered.notice, 'none');
    assert.equal(recovered.failures.length, 0);
    assert.equal(mapNoticeMessage(recovered.notice), null);
  });

  it('is identity when there was nothing to clear, so it costs no render', () => {
    assert.equal(clearMapError(INITIAL_MAP_ERROR_STATE), INITIAL_MAP_ERROR_STATE);
  });

  it('starts counting from zero after a recovery', () => {
    let state = INITIAL_MAP_ERROR_STATE;
    for (let i = 0; i < MAP_ERROR_THRESHOLD; i += 1) {
      state = feed(state, { error: { message: 'Failed to fetch' } }, 100 * i);
    }
    state = clearMapError(state);
    state = feed(state, { error: { message: 'Failed to fetch' } }, 1_000);
    assert.equal(state.notice, 'none', 'one failure after recovery is still just one failure');
  });
});

describe('describeMapError', () => {
  it('keeps the raw codes so a field screenshot can name what failed', () => {
    const described = describeMapError({
      sourceId: 'openmaptiles',
      error: { status: 503, url: STYLE_URL, message: 'Service Unavailable' },
    });
    assert.match(described, /source=openmaptiles/);
    assert.match(described, /status=503/);
    assert.match(described, /Service Unavailable/);
  });
});
