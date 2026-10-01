import type { ParentCrewSummary } from '@school-bus-tracking/shared-types';

/**
 * Resolves how a crew member's avatar should render on the parent
 * trip-tracking screen.
 *
 * The parent-tracking payload exposes the uploaded photo's *storage key*
 * (`ParentCrewSummary.profile_photo_key`), or `null` when the crew member has
 * not set a photo, plus `profile_photo_updated_at` as the cache-buster.
 * `null` — or any unusable input, like a missing API base — resolves to
 * `fallback`: a plain neutral avatar icon next to the name.
 *
 * ### Why the key, and not a URL to hand to `<Image>`
 *
 * The photo route is authenticated, and an `Authorization` header passed
 * inside `<Image source>` is unreliable: React Native's iOS image loader and
 * its cache layer do not consistently forward custom headers, so the request
 * arrives without a token, the API answers its generic 404, and the parent
 * sees a permanently blank avatar. The bytes are therefore **downloaded**
 * through the shared API client (which owns the token and the 401 refresh)
 * and rendered from memory — see `features/profile/useProfilePhoto.ts`.
 *
 * `photo` consequently carries the *key* and the version, not a URL. The URL
 * builder below stays for the request the client makes (and for tests that
 * pin the address shape).
 *
 * Pure and exported for the unit spec; the component (`CrewAvatar`) only maps
 * this union onto React Native elements.
 */
export type CrewAvatarPresentation =
  { kind: 'photo'; key: string; version: string | null } | { kind: 'fallback' };

/** Decides the avatar rendering for one crew member summary. */
export function crewAvatarPresentation(
  crew:
    Pick<ParentCrewSummary, 'profile_photo_key' | 'profile_photo_updated_at'> | null | undefined,
  apiBase: string | null | undefined,
): CrewAvatarPresentation {
  const key = crew?.profile_photo_key?.trim();
  // A missing API base is still a fallback: in a release build without
  // `EXPO_PUBLIC_API_URL` there is nowhere to fetch from, and an avatar must
  // never mask that configuration error.
  if (!key || !apiBase) return { kind: 'fallback' };
  return { kind: 'photo', key, version: crew?.profile_photo_updated_at?.trim() || null };
}

/**
 * Maps a photo storage key to the API URL the bytes are fetched from — the
 * address the API client requests (it is never handed to `<Image>`).
 *
 * `null` when there is nothing to fetch (no key) or no way to fetch it (the
 * API base URL could not be resolved — a release build without
 * `EXPO_PUBLIC_API_URL`, where an avatar never masks the real configuration
 * error). Each storage-key segment is URI-encoded so keys stay opaque.
 */
export function crewPhotoUri(
  photoKey: string | null | undefined,
  apiBase: string | null | undefined,
  updatedAt?: string | null,
): string | null {
  if (!photoKey || !photoKey.trim() || !apiBase) {
    return null;
  }
  const base = apiBase.replace(/\/+$/, '');
  const encoded = photoKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  // `?v=<profile_photo_updated_at>` is the cache-buster: the API derives its
  // ETag from the same column, so a replaced photo is a different address
  // and no layer in between can serve the previous face.
  const version = updatedAt?.trim() ? `?v=${encodeURIComponent(updatedAt.trim())}` : '';
  return `${base}/crew-photos/${encoded}${version}`;
}
