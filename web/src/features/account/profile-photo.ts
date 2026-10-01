import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';

/**
 * The decisions behind the console's profile-photo surface, as pure
 * functions — the same split `features/auth/password-reset.ts` uses, so
 * `profile-photo.spec.ts` can pin them under `node --test` (the repo has no
 * DOM test runner).
 *
 * No React, no DOM, no API client, and **no runtime relative imports**: the
 * web specs run under `node --experimental-strip-types`, whose ESM resolver
 * has no extensionless lookup, so this module imports packages and types
 * only.
 *
 * The limits below deliberately mirror the server's
 * (`web/src/server/modules/account/account.constants.ts`) **word for word**.
 * A client-side pre-check that says something different from the rejection
 * the API would send is worse than no pre-check at all.
 */

/** Hard upload cap — mirrors `PROFILE_PHOTO_MAX_BYTES` (2 MB). */
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Mirrors `PROFILE_PHOTO_ALLOWED_MIME_TYPES`. */
export const PROFILE_PHOTO_ACCEPTED_TYPES = ['image/jpeg', 'image/png'] as const;

/** The `accept` attribute of the file input, from the same list. */
export const PROFILE_PHOTO_ACCEPT_ATTRIBUTE = PROFILE_PHOTO_ACCEPTED_TYPES.join(',');

/** Mirrors `PROFILE_PHOTO_TYPE_MESSAGE`. */
export const PROFILE_PHOTO_TYPE_MESSAGE = 'Profile photos must be a JPEG or PNG image.';

/** Mirrors `PROFILE_PHOTO_TOO_LARGE_MESSAGE`. */
export const PROFILE_PHOTO_TOO_LARGE_MESSAGE = 'Profile photos must be at most 2 MB.';

/** Mirrors `PROFILE_PHOTO_REQUIRED_MESSAGE`. */
export const PROFILE_PHOTO_REQUIRED_MESSAGE = 'Please attach a profile photo.';

/** Shown once the API has accepted an upload. */
export const PROFILE_PHOTO_UPDATED_MESSAGE = 'Profile photo updated.';

/** Shown once the API has accepted a removal. */
export const PROFILE_PHOTO_REMOVED_MESSAGE = 'Profile photo removed.';

/** The one thing a chosen file can be wrong about, or `null` when it is fine. */
export function profilePhotoFileError(
  file: { type?: string; size?: number } | null | undefined,
): string | null {
  if (!file) return PROFILE_PHOTO_REQUIRED_MESSAGE;
  const type = (file.type ?? '').toLowerCase();
  if (!PROFILE_PHOTO_ACCEPTED_TYPES.some((allowed) => allowed === type)) {
    return PROFILE_PHOTO_TYPE_MESSAGE;
  }
  if ((file.size ?? 0) <= 0) return PROFILE_PHOTO_REQUIRED_MESSAGE;
  if ((file.size ?? 0) > PROFILE_PHOTO_MAX_BYTES) return PROFILE_PHOTO_TOO_LARGE_MESSAGE;
  return null;
}

/** How an avatar renders: the fetched photo, or the initials fallback. */
export type AvatarPresentation =
  { kind: 'photo'; src: string } | { kind: 'initials'; initials: string };

/** Initials for the fallback — never empty, never a broken image. */
export function profileInitials(
  user: Pick<AuthenticatedUser, 'first_name' | 'last_name'> | null | undefined,
): string {
  const first = (user?.first_name ?? '').trim().charAt(0);
  const last = (user?.last_name ?? '').trim().charAt(0);
  const text = `${first}${last}`.toUpperCase();
  return text || '?';
}

/**
 * Resolves the avatar for a session user plus whatever the photo fetch has
 * produced so far.
 *
 * `objectUrl` is `null` while the bytes are still loading, when the account
 * has no photo, and when the server answered its generic 404 — all three are
 * the same thing on screen, which is the point: the UI never explains why a
 * photo is absent, because the API deliberately does not say.
 */
export function avatarPresentation(
  user: Pick<AuthenticatedUser, 'first_name' | 'last_name'> | null | undefined,
  objectUrl: string | null | undefined,
): AvatarPresentation {
  if (objectUrl && objectUrl.trim()) return { kind: 'photo', src: objectUrl };
  return { kind: 'initials', initials: profileInitials(user) };
}

/**
 * Whether the session says there is a photo to fetch at all.
 *
 * The session payload carries the storage key, so a cold load knows before
 * any request whether to show initials — and an upload that just succeeded
 * updates the same two fields, which is what makes the sidebar change
 * immediately instead of after the next sign-in.
 */
export function hasProfilePhoto(
  user: Pick<AuthenticatedUser, 'profile_photo_key'> | null | undefined,
): boolean {
  return Boolean(user?.profile_photo_key && user.profile_photo_key.trim());
}
