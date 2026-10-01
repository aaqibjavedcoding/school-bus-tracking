import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PROFILE_PHOTO_KEY_SEGMENT,
  normalizeProfilePhotoKey,
  profilePhotoContentType,
  profilePhotoETag,
  profilePhotoKeyBelongsToSchool,
  profilePhotoNotModified,
} from './profile-photo-key';

/**
 * The parsing half of the photo-read guard.
 *
 * Profile photos share a blob store with driver licences and insurance
 * documents, so this module's job is to make sure a URL segment can never
 * address anything but a photo-shaped key. Nothing here grants access — the
 * tenant/row checks are in `account.service.spec.ts` — but everything here
 * is a way a careless handler could be talked out of its own rules.
 */

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER = '07070707-0707-4707-8707-070707070701';
const VALID = [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, 'abcd1234-photo.jpg'];

describe('normalizeProfilePhotoKey', () => {
  it('accepts the shape the write side produces', () => {
    assert.equal(normalizeProfilePhotoKey(VALID), VALID.join('/'));
  });

  it('accepts an already-joined key (the /account/me path and tests)', () => {
    assert.equal(normalizeProfilePhotoKey(VALID.join('/')), VALID.join('/'));
  });

  it('refuses traversal in every spelling', () => {
    for (const segments of [
      ['..', PROFILE_PHOTO_KEY_SEGMENT, USER, 'photo.jpg'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, '..', 'photo.jpg'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, '..%2fsecret.pdf'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, 'a..b/photo.jpg'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, '%2e%2e', 'photo.jpg'],
    ]) {
      assert.equal(normalizeProfilePhotoKey(segments), null, segments.join('/'));
    }
  });

  it('refuses separators, absolute paths and empty segments', () => {
    for (const segments of [
      ['', PROFILE_PHOTO_KEY_SEGMENT, USER, 'photo.jpg'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, ''],
      [`/etc`, PROFILE_PHOTO_KEY_SEGMENT, USER, 'passwd'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, 'a\\b.jpg'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, 'photo%2F..%2Fx.jpg'],
      [SCHOOL_A, PROFILE_PHOTO_KEY_SEGMENT, USER, 'photo\u0000.jpg'],
    ]) {
      assert.equal(normalizeProfilePhotoKey(segments), null, JSON.stringify(segments));
    }
  });

  it('refuses a key that is not in the profile-photos folder', () => {
    // The blob store also holds driver licences and bus RCs; this is the
    // first of the four independent reasons such a key is never served.
    assert.equal(
      normalizeProfilePhotoKey([SCHOOL_A, 'driver-licenses', USER, 'licence.pdf']),
      null,
    );
    assert.equal(normalizeProfilePhotoKey([SCHOOL_A, 'bus-documents', USER, 'rc.pdf']), null);
  });

  it('refuses anything that is not a pair of segments at minimum', () => {
    assert.equal(normalizeProfilePhotoKey(undefined), null);
    assert.equal(normalizeProfilePhotoKey(null), null);
    assert.equal(normalizeProfilePhotoKey([]), null);
    assert.equal(normalizeProfilePhotoKey([SCHOOL_A]), null);
    assert.equal(normalizeProfilePhotoKey([SCHOOL_A, 42 as unknown as string]), null);
  });
});

describe('profilePhotoKeyBelongsToSchool', () => {
  it("matches only the caller's own tenant prefix", () => {
    const key = VALID.join('/');
    assert.equal(profilePhotoKeyBelongsToSchool(key, SCHOOL_A), true);
    assert.equal(profilePhotoKeyBelongsToSchool(key, SCHOOL_B), false);
  });

  it('never matches for a tenant-less caller (the platform SUPER_ADMIN)', () => {
    assert.equal(profilePhotoKeyBelongsToSchool(VALID.join('/'), null), false);
  });

  it('is not fooled by a school id that is only a prefix of another', () => {
    assert.equal(
      profilePhotoKeyBelongsToSchool(`${SCHOOL_A}-2/profile-photos/u/p.jpg`, SCHOOL_A),
      false,
    );
  });
});

describe('profilePhotoContentType', () => {
  it('serves only JPEG and PNG', () => {
    assert.equal(profilePhotoContentType('image/jpeg'), 'image/jpeg');
    assert.equal(profilePhotoContentType('image/png'), 'image/png');
    assert.equal(profilePhotoContentType('IMAGE/PNG; charset=binary'), 'image/png');
    assert.equal(profilePhotoContentType('image/jpg'), 'image/jpeg');
  });

  it('refuses everything else, including anything that could be a document', () => {
    for (const type of ['application/pdf', 'image/svg+xml', 'text/html', '', null, undefined]) {
      assert.equal(profilePhotoContentType(type), null, String(type));
    }
  });
});

describe('profilePhotoETag / profilePhotoNotModified', () => {
  it('derives the validator from profile_photo_updated_at', () => {
    const updatedAt = new Date('2026-10-01T06:00:00.000Z');
    assert.equal(profilePhotoETag(updatedAt), `"${updatedAt.getTime()}"`);
    assert.equal(profilePhotoETag(updatedAt.toISOString()), `"${updatedAt.getTime()}"`);
  });

  it('has no validator when the column is empty or unusable', () => {
    assert.equal(profilePhotoETag(null), null);
    assert.equal(profilePhotoETag(undefined), null);
    assert.equal(profilePhotoETag('not a date'), null);
  });

  it('honours a conditional request, list and weak forms included', () => {
    const etag = '"1759300000000"';
    assert.equal(profilePhotoNotModified(etag, etag), true);
    assert.equal(profilePhotoNotModified(`W/${etag}`, etag), true);
    assert.equal(profilePhotoNotModified(`"other", ${etag}`, etag), true);
    assert.equal(profilePhotoNotModified('*', etag), true);
    assert.equal(profilePhotoNotModified('"stale"', etag), false);
    assert.equal(profilePhotoNotModified(null, etag), false);
    assert.equal(profilePhotoNotModified(etag, null), false);
  });
});
