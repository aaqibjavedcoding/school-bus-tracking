import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MIN_PHOTO_WIDTH,
  initialProfilePhotoState,
  isProfilePhotoBusy,
  parseStoredProfilePhoto,
  pickPictureSize,
  profileAvatarPresentation,
  profilePhotoMessage,
  profilePhotoReducer,
  profilePhotoStorageKey,
  profilePhotoUploadPart,
  retryAttempt,
  serializeStoredProfilePhoto,
  type ProfilePhotoEvent,
  type ProfilePhotoState,
} from './profile-photo.ts';

/**
 * "My Profile" photo — the behaviour of the crew card, without a device.
 *
 * The card itself is React and a camera; everything it *decides* is in
 * `profile-photo.ts`, so the rules the feature was asked for are pinned here:
 * online-only (no queue anywhere), one manual retry that repeats exactly what
 * failed, a placeholder whenever there is no usable photo, and an upload the
 * API's JPEG/PNG + 2 MB rules can accept.
 */

const CAPTURE = 'file:///data/user/0/app/cache/Camera/abc123.jpg';

/** Folds a list of events over the reducer, like the card does. */
function run(events: ProfilePhotoEvent[], from = initialProfilePhotoState): ProfilePhotoState {
  return events.reduce(profilePhotoReducer, from);
}

describe('avatar presentation', () => {
  test('falls back to the placeholder when this device knows no photo', () => {
    assert.deepEqual(profileAvatarPresentation(null), { kind: 'fallback' });
    assert.deepEqual(profileAvatarPresentation(undefined), { kind: 'fallback' });
    assert.deepEqual(profileAvatarPresentation(''), { kind: 'fallback' });
    assert.deepEqual(profileAvatarPresentation('   '), { kind: 'fallback' });
  });

  test('renders the photo the device set', () => {
    assert.deepEqual(profileAvatarPresentation(CAPTURE), { kind: 'photo', uri: CAPTURE });
  });
});

describe('taking a photo', () => {
  test('opening the camera is not an outcome worth announcing', () => {
    const opened = run([
      { type: 'started', attempt: { action: 'capture' } },
      { type: 'succeeded' },
    ]);
    assert.equal(opened.status, 'idle');
    assert.equal(profilePhotoMessage(opened), null);
    assert.equal(opened.attempt, null);
  });

  test('a confirmed upload becomes the photo on the card, with the success message', () => {
    const uploaded = run([
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'succeeded' },
    ]);
    assert.equal(uploaded.photoUri, CAPTURE);
    assert.equal(profilePhotoMessage(uploaded), 'success');
    assert.deepEqual(profileAvatarPresentation(uploaded.photoUri), {
      kind: 'photo',
      uri: CAPTURE,
    });
  });

  test('every action blocks the others while it is on the wire', () => {
    const working = run([{ type: 'started', attempt: { action: 'upload', uri: CAPTURE } }]);
    assert.equal(isProfilePhotoBusy(working), true);
    assert.equal(isProfilePhotoBusy(initialProfilePhotoState), false);
    assert.equal(profilePhotoMessage(working), null, 'no stale message while working');
  });
});

describe('removing the photo', () => {
  test('a confirmed removal clears the card back to the placeholder', () => {
    const removed = run([
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'succeeded' },
      { type: 'started', attempt: { action: 'remove' } },
      { type: 'succeeded' },
    ]);
    assert.equal(removed.photoUri, null);
    assert.deepEqual(profileAvatarPresentation(removed.photoUri), { kind: 'fallback' });
    // The same success line covers both actions — the photo on file changed.
    assert.equal(profilePhotoMessage(removed), 'success');
  });
});

describe('failure is online-only: one error, one manual retry', () => {
  test('a failed upload keeps the captured file as the retry target', () => {
    const failed = run([
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'failed' },
    ]);
    assert.equal(profilePhotoMessage(failed), 'error');
    assert.deepEqual(retryAttempt(failed), { action: 'upload', uri: CAPTURE });
    // Nothing is queued and nothing is claimed: the old photo state stands.
    assert.equal(failed.photoUri, null);
    assert.equal(isProfilePhotoBusy(failed), false);
  });

  test('a failed removal retries the removal, not an upload', () => {
    const failed = run([
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'succeeded' },
      { type: 'started', attempt: { action: 'remove' } },
      { type: 'failed' },
    ]);
    assert.deepEqual(retryAttempt(failed), { action: 'remove' });
    // The photo is still on screen: the server never confirmed it was gone.
    assert.equal(failed.photoUri, CAPTURE);
  });

  test('a refused camera permission retries the camera', () => {
    const failed = run([{ type: 'started', attempt: { action: 'capture' } }, { type: 'failed' }]);
    assert.equal(profilePhotoMessage(failed), 'error');
    assert.deepEqual(retryAttempt(failed), { action: 'capture' });
  });

  test('there is no retry target while idle, working or successful', () => {
    assert.equal(retryAttempt(initialProfilePhotoState), null);
    assert.equal(retryAttempt(run([{ type: 'started', attempt: { action: 'remove' } }])), null);
    assert.equal(
      retryAttempt(
        run([{ type: 'started', attempt: { action: 'remove' } }, { type: 'succeeded' }]),
      ),
      null,
    );
  });

  test('a retry that succeeds replaces the error with the success message', () => {
    const recovered = run([
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'failed' },
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'succeeded' },
    ]);
    assert.equal(profilePhotoMessage(recovered), 'success');
    assert.equal(retryAttempt(recovered), null);
    assert.equal(recovered.photoUri, CAPTURE);
  });

  test('a stray success with nothing in flight changes nothing', () => {
    assert.deepEqual(
      profilePhotoReducer(initialProfilePhotoState, { type: 'succeeded' }),
      initialProfilePhotoState,
    );
  });
});

describe('the device mirror never overwrites a newer local truth', () => {
  test('it fills an untouched card', () => {
    const restored = run([{ type: 'restored', photoUri: CAPTURE }]);
    assert.equal(restored.photoUri, CAPTURE);
  });

  test('a late read cannot resurrect a photo the crew member just removed', () => {
    const afterRemoval = run([
      { type: 'started', attempt: { action: 'remove' } },
      { type: 'succeeded' },
      { type: 'restored', photoUri: CAPTURE },
    ]);
    assert.equal(afterRemoval.photoUri, null);
  });

  test('a late read cannot replace a photo just taken', () => {
    const fresh = 'file:///cache/new.jpg';
    const afterUpload = run([
      { type: 'started', attempt: { action: 'upload', uri: fresh } },
      { type: 'succeeded' },
      { type: 'restored', photoUri: CAPTURE },
    ]);
    assert.equal(afterUpload.photoUri, fresh);
  });

  test('a late read cannot land in the middle of an attempt', () => {
    const working = run([
      { type: 'started', attempt: { action: 'upload', uri: CAPTURE } },
      { type: 'restored', photoUri: 'file:///cache/old.jpg' },
    ]);
    assert.equal(working.photoUri, null);
    assert.equal(working.status, 'working');
  });
});

describe('upload part (the API validates extension AND declared type)', () => {
  test('a camera capture is sent as a JPEG named for its extension', () => {
    assert.deepEqual(profilePhotoUploadPart(CAPTURE), {
      uri: CAPTURE,
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
  });

  test('a PNG capture is declared as a PNG', () => {
    const uri = 'file:///cache/shot.PNG';
    assert.deepEqual(profilePhotoUploadPart(uri), {
      uri,
      name: 'photo.png',
      type: 'image/png',
    });
  });

  test('a query string or an unknown extension still yields an accepted pair', () => {
    for (const uri of [
      'file:///cache/shot.jpg?ts=17',
      'file:///cache/shot',
      'content://media/42',
    ]) {
      const part = profilePhotoUploadPart(uri);
      assert.ok(part, `${uri} must still be uploadable`);
      assert.match(part.name, /\.(jpg|png)$/);
      assert.ok(['image/jpeg', 'image/png'].includes(part.type));
      // Extension and declared type can never disagree — the API rejects that.
      assert.equal(part.type === 'image/png', part.name.endsWith('.png'));
      assert.equal(part.uri, uri);
    }
  });

  test('there is nothing to upload for a missing capture', () => {
    assert.equal(profilePhotoUploadPart(null), null);
    assert.equal(profilePhotoUploadPart(undefined), null);
    assert.equal(profilePhotoUploadPart('   '), null);
  });
});

describe('capture size stays small enough for the 2 MB cap', () => {
  test('picks the smallest size that is still big enough for an avatar', () => {
    assert.equal(pickPictureSize(['4032x3024', '1920x1080', '640x480', '1280x720']), '1280x720');
  });

  test('understands iOS capture presets and ignores the unparseable ones', () => {
    assert.equal(
      pickPictureSize(['photo', 'high', 'hd1920x1080', 'hd1280x720', 'vga640x480']),
      'hd1280x720',
    );
  });

  test('falls back to the largest option when every size is small', () => {
    assert.equal(pickPictureSize(['320x240', '640x480']), '640x480');
  });

  test('leaves the camera on its own default when nothing is parseable', () => {
    assert.equal(pickPictureSize(['photo', 'high', 'medium']), undefined);
    assert.equal(pickPictureSize([]), undefined);
    assert.equal(pickPictureSize(null), undefined);
    assert.equal(pickPictureSize(undefined), undefined);
  });

  test('the chosen size is at least the avatar width whenever one exists', () => {
    const chosen = pickPictureSize(['4032x3024', '800x600', '1280x720']);
    const width = Number(/(\d+)x/.exec(chosen ?? '')?.[1]);
    assert.ok(width >= MIN_PHOTO_WIDTH, `${chosen} is below ${MIN_PHOTO_WIDTH}px`);
  });
});

describe('device mirror storage (the API is write-only in Phase 2A)', () => {
  test('the key is scoped per crew account, so a shared phone never leaks a face', () => {
    assert.equal(profilePhotoStorageKey('user-1'), 'sbt.mobile.profile-photo.user-1');
    assert.notEqual(profilePhotoStorageKey('user-1'), profilePhotoStorageKey('user-2'));
  });

  test('round-trips a photo the API confirmed', () => {
    const photo = { uri: CAPTURE, key: 'school-1/profile-photos/user-2/abc-photo.jpg' };
    assert.deepEqual(parseStoredProfilePhoto(serializeStoredProfilePhoto(photo)), photo);
  });

  test('anything absent, corrupt or half-written reads as "no photo"', () => {
    for (const raw of [
      null,
      undefined,
      '',
      'not json',
      '[]',
      '"string"',
      '{}',
      JSON.stringify({ uri: CAPTURE }),
      JSON.stringify({ key: 'k' }),
      JSON.stringify({ uri: '  ', key: 'k' }),
      JSON.stringify({ uri: CAPTURE, key: '' }),
      JSON.stringify({ uri: 7, key: 'k' }),
    ]) {
      assert.equal(parseStoredProfilePhoto(raw), null, `${String(raw)} must not restore a photo`);
    }
  });
});
