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
 *
 * **Updated with the read-back (this change).** The resolution used to
 * return a ready-made URL for `<Image source>` to fetch with an
 * `Authorization` header — which React Native does not reliably forward, so
 * the avatar stayed blank. It now returns the **key plus the version**, and
 * the bytes are downloaded through the shared API client before being
 * rendered. The URL builder is still pinned below, because it is the address
 * that client requests; it now carries `?v=<profile_photo_updated_at>`.
 */

/** A crew summary as the tracking payload delivers it. */
const crew = (key: string | null, updatedAt: string | null = null) => ({
  profile_photo_key: key,
  profile_photo_updated_at: updatedAt,
});
describe('crewAvatarPresentation — fallback', () => {
  test('falls back when there is no crew member at all', () => {
    assert.deepEqual(crewAvatarPresentation(null, API_BASE), { kind: 'fallback' });
    assert.deepEqual(crewAvatarPresentation(undefined, API_BASE), { kind: 'fallback' });
  });

  test('falls back when no photo is set (the state of every crew member today)', () => {
    assert.deepEqual(crewAvatarPresentation(crew(null), API_BASE), { kind: 'fallback' });
  });

  test('falls back on an empty or blank key rather than rendering a broken image', () => {
    assert.deepEqual(crewAvatarPresentation(crew(''), API_BASE), { kind: 'fallback' });
    assert.deepEqual(crewAvatarPresentation(crew('   '), API_BASE), { kind: 'fallback' });
  });

  test('falls back when the API base URL could not be resolved for this build', () => {
    assert.deepEqual(crewAvatarPresentation(crew('school/profile-photos/user/photo.jpg'), null), {
      kind: 'fallback',
    });
    assert.deepEqual(
      crewAvatarPresentation(crew('school/profile-photos/user/photo.jpg'), undefined),
      { kind: 'fallback' },
    );
  });
});

describe('crewAvatarPresentation — photo', () => {
  const key = 'school-1/profile-photos/user-2/abcd1234-photo.jpg';

  test('hands the key to the authenticated download, not a URL to <Image>', () => {
    // A URL here would be rendered directly by <Image>, which is exactly the
    // path that silently dropped the bearer token.
    assert.deepEqual(crewAvatarPresentation(crew(key), API_BASE), {
      kind: 'photo',
      key,
      version: null,
    });
  });

  test('carries the version so a replaced photo is never served from a cache', () => {
    assert.deepEqual(crewAvatarPresentation(crew(key, '2026-10-01T09:00:00.000Z'), API_BASE), {
      kind: 'photo',
      key,
      version: '2026-10-01T09:00:00.000Z',
    });
    // A blank timestamp is "no version", not an empty query parameter.
    assert.deepEqual(crewAvatarPresentation(crew(key, '   '), API_BASE), {
      kind: 'photo',
      key,
      version: null,
    });
  });

  test('the presentation never contains a token or a full URL', () => {
    const resolved = crewAvatarPresentation(crew(key, '2026-10-01T09:00:00.000Z'), API_BASE);
    assert.ok(!JSON.stringify(resolved).includes('http'), 'no URL for <Image> to fetch');
    assert.ok(!JSON.stringify(resolved).toLowerCase().includes('authorization'));
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

  test('a trailing slash on the API base does not double the separator', () => {
    assert.equal(
      crewPhotoUri('k/photo.png', `${API_BASE}/`),
      `${API_BASE}/crew-photos/k/photo.png`,
    );
  });

  test('appends the photo version as ?v=, encoded', () => {
    assert.equal(
      crewPhotoUri('k/photo.png', API_BASE, '2026-10-01T09:00:00.000Z'),
      `${API_BASE}/crew-photos/k/photo.png?v=2026-10-01T09%3A00%3A00.000Z`,
    );
    assert.equal(
      crewPhotoUri('k/photo.png', API_BASE, '  '),
      `${API_BASE}/crew-photos/k/photo.png`,
    );
  });
});
