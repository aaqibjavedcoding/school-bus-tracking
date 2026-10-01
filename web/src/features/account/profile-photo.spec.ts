import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  PROFILE_PHOTO_ACCEPTED_TYPES,
  PROFILE_PHOTO_ACCEPT_ATTRIBUTE,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_REQUIRED_MESSAGE,
  PROFILE_PHOTO_TOO_LARGE_MESSAGE,
  PROFILE_PHOTO_TYPE_MESSAGE,
  avatarPresentation,
  hasProfilePhoto,
  profileInitials,
  profilePhotoFileError,
} from './profile-photo.ts';

/**
 * The console's profile-photo rules.
 *
 * Two things are worth a test here and both are about *not lying to the
 * user*: the client-side pre-check has to agree with the API it is
 * pre-empting (same limits, same sentences — the file is a mirror of
 * `server/modules/account/account.constants.ts`), and the avatar must fall
 * back to initials for every "no photo" case rather than render a broken
 * image or explain which case it was.
 */

const SERVER_MESSAGES = {
  type: 'Profile photos must be a JPEG or PNG image.',
  tooLarge: 'Profile photos must be at most 2 MB.',
  required: 'Please attach a profile photo.',
};

describe('the pre-check mirrors the API', () => {
  it("uses the server's own limits", () => {
    assert.equal(PROFILE_PHOTO_MAX_BYTES, 2 * 1024 * 1024);
    assert.deepEqual([...PROFILE_PHOTO_ACCEPTED_TYPES], ['image/jpeg', 'image/png']);
    assert.equal(PROFILE_PHOTO_ACCEPT_ATTRIBUTE, 'image/jpeg,image/png');
  });

  it("uses the server's own sentences, word for word", () => {
    assert.equal(PROFILE_PHOTO_TYPE_MESSAGE, SERVER_MESSAGES.type);
    assert.equal(PROFILE_PHOTO_TOO_LARGE_MESSAGE, SERVER_MESSAGES.tooLarge);
    assert.equal(PROFILE_PHOTO_REQUIRED_MESSAGE, SERVER_MESSAGES.required);
  });

  it('accepts a JPEG or PNG inside the cap', () => {
    assert.equal(profilePhotoFileError({ type: 'image/jpeg', size: 1024 }), null);
    assert.equal(profilePhotoFileError({ type: 'image/png', size: PROFILE_PHOTO_MAX_BYTES }), null);
    assert.equal(profilePhotoFileError({ type: 'IMAGE/PNG', size: 10 }), null);
  });

  it('rejects the wrong type before spending an upload on it', () => {
    for (const type of ['application/pdf', 'image/gif', 'image/svg+xml', '']) {
      assert.equal(profilePhotoFileError({ type, size: 10 }), PROFILE_PHOTO_TYPE_MESSAGE, type);
    }
  });

  it('rejects an oversized or empty file', () => {
    assert.equal(
      profilePhotoFileError({ type: 'image/jpeg', size: PROFILE_PHOTO_MAX_BYTES + 1 }),
      PROFILE_PHOTO_TOO_LARGE_MESSAGE,
    );
    assert.equal(
      profilePhotoFileError({ type: 'image/jpeg', size: 0 }),
      PROFILE_PHOTO_REQUIRED_MESSAGE,
    );
    assert.equal(profilePhotoFileError(null), PROFILE_PHOTO_REQUIRED_MESSAGE);
    assert.equal(profilePhotoFileError(undefined), PROFILE_PHOTO_REQUIRED_MESSAGE);
  });
});

describe('avatar presentation', () => {
  const user = { first_name: 'Asha', last_name: 'Admin' };

  it('shows the fetched photo when there is one', () => {
    assert.deepEqual(avatarPresentation(user, 'blob:https://console/abc'), {
      kind: 'photo',
      src: 'blob:https://console/abc',
    });
  });

  it('falls back to initials for every "nothing to show" case', () => {
    // Loading, no photo and the server's generic 404 are the same state
    // here on purpose — the UI must not be able to tell them apart.
    for (const value of [null, undefined, '', '   ']) {
      assert.deepEqual(avatarPresentation(user, value), { kind: 'initials', initials: 'AA' });
    }
  });

  it('never renders empty initials', () => {
    assert.equal(profileInitials({ first_name: '', last_name: '' }), '?');
    assert.equal(profileInitials(null), '?');
    assert.equal(profileInitials({ first_name: 'dana', last_name: 'driver' }), 'DD');
  });
});

describe('hasProfilePhoto', () => {
  it('reads the session payload, which is what makes an upload visible at once', () => {
    assert.equal(hasProfilePhoto({ profile_photo_key: 'school/profile-photos/u/p.jpg' }), true);
    assert.equal(hasProfilePhoto({ profile_photo_key: null }), false);
    assert.equal(hasProfilePhoto({ profile_photo_key: '  ' }), false);
    assert.equal(hasProfilePhoto(null), false);
  });
});
