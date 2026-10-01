import type { UploadFilePart } from '@school-bus-tracking/api-client';

/**
 * "My Profile" photo — the pure half of the self-service card.
 *
 * React-free and native-free on purpose (same rule as `sos-flow.ts` and
 * `crew-feedback.ts`): every decision the card makes is a function here, so
 * `profile-photo.spec.ts` can pin it under plain `node --test` without a
 * device, a camera or a network.
 *
 * ### The three rules this module encodes
 *
 * 1. **Online only, no queue.** Setting or clearing an avatar is a low-stakes
 *    action nobody is waiting on — unlike an attendance mark, which must
 *    survive a dead zone (`features/crew/offline`). So there is no `queued`
 *    state anywhere below: an attempt either succeeds against the server or
 *    ends in `error`, and the error keeps the exact attempt that failed so the
 *    crew member can retry it by hand.
 * 2. **One manual retry target.** {@link retryAttempt} hands the card the very
 *    attempt that failed — the same captured file for an upload, the same
 *    delete for a removal, the same permission request for a capture. Nothing
 *    retries itself in the background.
 * 3. **Only a server-confirmed change announces itself.** Opening the camera
 *    succeeding is not news; the success message is reserved for the two
 *    actions the API actually applied (see {@link profilePhotoReducer}).
 *
 * ### Where the photo comes from
 *
 * The server. The session payload carries `profile_photo_key` +
 * `profile_photo_updated_at`, and the bytes are fetched from the
 * authenticated photo route (`useProfilePhoto`), so a reinstall, a second
 * phone and a fresh login all show the same face. AsyncStorage survives only
 * as an **offline cache keyed by the storage key**
 * (`profile-photo-storage.ts`), never as the authority on whether a photo
 * exists — the previous build mirrored the raw camera-cache URI per user,
 * which rotted with the cache directory.
 *
 * "Remove Photo" stays unconditional for the same reason it always was: the
 * server may hold a photo this device has not loaded, and `DELETE` is
 * idempotent.
 */

/** What the card is doing, or was doing when it failed. */
export type ProfilePhotoAttempt =
  /** Opening the camera (permission request + capture). */
  | { action: 'capture' }
  /** Sending a captured file to `PUT /account/me/photo`. */
  | { action: 'upload'; uri: string }
  /** `DELETE /account/me/photo`. */
  | { action: 'remove' };

/** Lifecycle of the card. `working` covers exactly one attempt at a time. */
export type ProfilePhotoStatus = 'idle' | 'working' | 'success' | 'error';

export interface ProfilePhotoState {
  /** Local URI of the photo this device set, or `null` for the placeholder. */
  photoUri: string | null;
  status: ProfilePhotoStatus;
  /** The in-flight attempt, or — while `error` — the one to retry. */
  attempt: ProfilePhotoAttempt | null;
}

export type ProfilePhotoEvent =
  /** The device mirror finished loading (cold start). */
  | { type: 'restored'; photoUri: string | null }
  | { type: 'started'; attempt: ProfilePhotoAttempt }
  | { type: 'succeeded' }
  | { type: 'failed' };

export const initialProfilePhotoState: ProfilePhotoState = {
  photoUri: null,
  status: 'idle',
  attempt: null,
};

/**
 * The card's whole behaviour, as a reducer.
 *
 * `restored` deliberately loses to anything the user has since done: the
 * photo it carries arrives asynchronously (the device cache first, then the
 * server), and a slow read must never resurrect a photo they just removed or
 * overwrite one they just took. It therefore only fills an untouched, idle
 * card.
 */
export function profilePhotoReducer(
  state: ProfilePhotoState,
  event: ProfilePhotoEvent,
): ProfilePhotoState {
  switch (event.type) {
    case 'restored': {
      const untouched = state.status === 'idle' && state.attempt === null && !state.photoUri;
      return untouched ? { ...state, photoUri: event.photoUri } : state;
    }
    case 'started':
      // A new attempt clears the previous outcome: one message on screen at a
      // time, and it always describes what just happened.
      return { ...state, status: 'working', attempt: event.attempt };
    case 'succeeded': {
      const attempt = state.attempt;
      if (!attempt) return state;
      if (attempt.action === 'capture') {
        // The camera opened — not something to congratulate anyone about. The
        // upload that follows owns the message.
        return { ...state, status: 'idle', attempt: null };
      }
      return {
        photoUri: attempt.action === 'upload' ? attempt.uri : null,
        status: 'success',
        attempt: null,
      };
    }
    case 'failed':
      // The attempt is kept: it IS the retry target.
      return { ...state, status: 'error' };
    default:
      return state;
  }
}

/** The attempt a manual retry must repeat, or `null` when nothing failed. */
export function retryAttempt(state: ProfilePhotoState): ProfilePhotoAttempt | null {
  return state.status === 'error' ? state.attempt : null;
}

/** True while an attempt is on the wire — every action disables itself. */
export function isProfilePhotoBusy(state: ProfilePhotoState): boolean {
  return state.status === 'working';
}

/**
 * Which of the two messages to render, if any. The card maps this onto
 * `t('profile.updated')` / `t('profile.error')` — the copy never branches
 * further, because the crew member's next move is the same either way.
 */
export function profilePhotoMessage(state: ProfilePhotoState): 'success' | 'error' | null {
  if (state.status === 'success') return 'success';
  if (state.status === 'error') return 'error';
  return null;
}

/** How the avatar renders: the device's photo, or the neutral placeholder. */
export type ProfileAvatarPresentation = { kind: 'photo'; uri: string } | { kind: 'fallback' };

/**
 * Resolves the avatar for a local photo URI.
 *
 * Mirrors the parent app's `crewAvatarPresentation` (`features/parent/crew-photo.ts`)
 * on purpose: same union, same "anything unusable falls back" rule, so both
 * surfaces degrade to the neutral icon instead of a broken image.
 */
export function profileAvatarPresentation(
  photoUri: string | null | undefined,
): ProfileAvatarPresentation {
  return photoUri && photoUri.trim() ? { kind: 'photo', uri: photoUri } : { kind: 'fallback' };
}

/** JPEG is what `expo-camera` writes on device; PNG is accepted all the same. */
const PHOTO_TYPES = {
  jpeg: { extension: '.jpg', contentType: 'image/jpeg', fileName: 'photo.jpg' },
  png: { extension: '.png', contentType: 'image/png', fileName: 'photo.png' },
} as const;

/**
 * Builds the multipart part for `PUT /account/me/photo` from a captured file.
 *
 * The API validates the extension **and** the declared MIME type, and rejects
 * anything that is not JPEG/PNG (`account.constants.ts`), so the two are
 * derived together from the capture's own extension and can never disagree.
 * An unrecognised extension is treated as JPEG, which is what `expo-camera`
 * produces on Android and iOS; the name is normalised because the storage
 * provider keys the blob by it and a camera's temp name carries nothing worth
 * keeping. Returns `null` for a URI there is nothing to send for.
 */
export function profilePhotoUploadPart(uri: string | null | undefined): UploadFilePart | null {
  const trimmed = uri?.trim();
  if (!trimmed) return null;
  // Strip a query/fragment before looking at the extension (`…/x.jpg?ts=1`).
  const path = trimmed.split(/[?#]/)[0]!.toLowerCase();
  const photoType = path.endsWith(PHOTO_TYPES.png.extension) ? PHOTO_TYPES.png : PHOTO_TYPES.jpeg;
  return { uri: trimmed, name: photoType.fileName, type: photoType.contentType };
}

/**
 * Picks the capture resolution to ask `expo-camera` for.
 *
 * The API caps a profile photo at 2 MB, and a full-sensor capture from a
 * modern phone blows past that even at a low JPEG quality — the crew member
 * would meet a rejection they cannot act on. `CameraView` can be pinned to a
 * smaller size instead, so the file is small *before* it is written.
 *
 * The device's list is unsorted and its shape differs per platform: Android
 * reports `"1920x1080"`, iOS reports capture presets (`"hd1280x720"`,
 * `"photo"`, `"medium"`). Both are handled by reading the first `WxH` pair in
 * each entry and ignoring everything without one. The choice is the smallest
 * size at least {@link MIN_PHOTO_WIDTH} wide — plenty for an avatar — or the
 * largest available when every option is smaller. `undefined` means "leave the
 * camera on its own default", the honest answer when nothing is parseable.
 */
export const MIN_PHOTO_WIDTH = 720;

export function pickPictureSize(sizes: readonly string[] | null | undefined): string | undefined {
  const parsed = (sizes ?? [])
    .map((size) => {
      const match = /(\d+)\s*[xX×]\s*(\d+)/.exec(size);
      return match ? { size, width: Number(match[1]), height: Number(match[2]) } : null;
    })
    .filter((entry): entry is { size: string; width: number; height: number } => {
      return entry !== null && entry.width > 0 && entry.height > 0;
    })
    .sort((a, b) => a.width * a.height - b.width * b.height);

  if (parsed.length === 0) return undefined;
  const bigEnough = parsed.find((entry) => entry.width >= MIN_PHOTO_WIDTH);
  return (bigEnough ?? parsed[parsed.length - 1]!).size;
}
