import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { crewAvatarPresentation, crewPhotoUri } from './crew-photo.ts';

const API_BASE = 'http://10.0.2.2:3001/api/v1';

/**
 * Parent-display fallback for crew photos on the trip-tracking screen.
 *
 * The tracking payload carries `profile_photo_key` for the assigned driver
 * and conductor; until a crew member actually has a photo the key is `null`
 * and the screen must show the plain neutral avatar icon — that is the state
 * every parent sees today, so it is pinned as the *default* behaviour.
 */
describe('crewAvatarPresentation — fallback', () => {
  test('falls back when there is no crew member at all', () => {
    assert.deepEqual(crewAvatarPresentation(null, API_BASE), { kind: 'fallback' });
    assert.deepEqual(crewAvatarPresentation(undefined, API_BASE), { kind: 'fallback' });
  });

  test('falls back when no photo is set (the state of every crew member today)', () => {
    assert.deepEqual(crewAvatarPresentation({ profile_photo_key: null }, API_BASE), {
      kind: 'fallback',
    });
  });

  test('falls back on an empty or blank key rather than rendering a broken image', () => {
    assert.deepEqual(crewAvatarPresentation({ profile_photo_key: '' }, API_BASE), {
      kind: 'fallback',
    });
    assert.deepEqual(crewAvatarPresentation({ profile_photo_key: '   ' }, API_BASE), {
      kind: 'fallback',
    });
  });

  test('falls back when the API base URL could not be resolved for this build', () => {
    assert.deepEqual(
      crewAvatarPresentation({ profile_photo_key: 'school/profile-photos/user/photo.jpg' }, null),
      { kind: 'fallback' },
    );
    assert.deepEqual(
      crewAvatarPresentation(
        { profile_photo_key: 'school/profile-photos/user/photo.jpg' },
        undefined,
      ),
      { kind: 'fallback' },
    );
  });
});

describe('crewAvatarPresentation — photo', () => {
  test('renders the stored photo once a key is present', () => {
    const key = 'school-1/profile-photos/user-2/abcd1234-photo.jpg';
    assert.deepEqual(crewAvatarPresentation({ profile_photo_key: key }, API_BASE), {
      kind: 'photo',
      uri: `${API_BASE}/crew-photos/${key}`,
    });
  });

  test('a trailing slash on the API base does not double the separator', () => {
    assert.deepEqual(crewAvatarPresentation({ profile_photo_key: 'k/photo.png' }, `${API_BASE}/`), {
      kind: 'photo',
      uri: `${API_BASE}/crew-photos/k/photo.png`,
    });
  });
});

describe('crewPhotoUri', () => {
  test('is null for any unusable input', () => {
    assert.equal(crewPhotoUri(null, API_BASE), null);
    assert.equal(crewPhotoUri(undefined, API_BASE), null);
    assert.equal(crewPhotoUri('k/photo.jpg', null), null);
  });

  test('encodes each storage-key segment so keys stay opaque', () => {
    assert.equal(
      crewPhotoUri('sch ool/profile-photos/u 1/ph#oto.jpg', API_BASE),
      `${API_BASE}/crew-photos/sch%20ool/profile-photos/u%201/ph%23oto.jpg`,
    );
  });
});
