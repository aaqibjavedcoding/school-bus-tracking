import type { ParentCrewSummary } from '@school-bus-tracking/shared-types';

/**
 * Resolves how a crew member's avatar should render on the parent
 * trip-tracking screen.
 *
 * The parent-tracking payload exposes the uploaded photo's *storage key*
 * (`ParentCrewSummary.profile_photo_key`), or `null` when the crew member has
 * not set a photo. `null` — or any unusable input, like a missing API base —
 * resolves to `fallback`: a plain neutral avatar icon next to the name.
 *
 * Pure and exported for the unit spec; the component (`CrewAvatar`) only maps
 * this union onto React Native elements.
 */
export type CrewAvatarPresentation = { kind: 'photo'; uri: string } | { kind: 'fallback' };

/** Decides the avatar rendering for one crew member summary. */
export function crewAvatarPresentation(
  crew: Pick<ParentCrewSummary, 'profile_photo_key'> | null | undefined,
  apiBase: string | null | undefined,
): CrewAvatarPresentation {
  const uri = crewPhotoUri(crew?.profile_photo_key, apiBase);
  return uri ? { kind: 'photo', uri } : { kind: 'fallback' };
}

/**
 * Maps a photo storage key to the API URL the bytes are fetched from.
 *
 * `null` when there is nothing to fetch (no key) or no way to fetch it (the
 * API base URL could not be resolved — a release build without
 * `EXPO_PUBLIC_API_URL`, where an avatar never masks the real configuration
 * error). Each storage-key segment is URI-encoded so keys stay opaque.
 */
export function crewPhotoUri(
  photoKey: string | null | undefined,
  apiBase: string | null | undefined,
): string | null {
  if (!photoKey || !photoKey.trim() || !apiBase) {
    return null;
  }
  const base = apiBase.replace(/\/+$/, '');
  const encoded = photoKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `${base}/crew-photos/${encoded}`;
}
