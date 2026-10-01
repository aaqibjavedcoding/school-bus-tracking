/**
 * Where the avatar on this phone comes from — the pure half of the fix for
 * "the photo disappears after a reinstall".
 *
 * ### What was wrong before
 *
 * The card used to remember the **raw camera capture URI**
 * (`file:///…/Camera/xyz.jpg`) in AsyncStorage, per user id. Expo's cache
 * directory is purgeable, so that URI rots on its own; a reinstall or a
 * second device had nothing at all, and showed the placeholder even though
 * the server was holding a photo. That was unavoidable while the API was
 * write-only — it no longer is.
 *
 * ### The rule now
 *
 * **The server is the source of truth.** The session payload carries
 * `profile_photo_key` + `profile_photo_updated_at` (`AuthenticatedUser`),
 * the bytes come from the authenticated photo route, and AsyncStorage is
 * only an **offline cache keyed by storage key** — never an authority on
 * whether a photo exists. A cache entry for a key the session no longer
 * names is simply ignored (and a new key never shows an old face, because
 * the key is part of the cache key).
 *
 * React-free and native-free, like every other `*.ts` beside a card here, so
 * `profile-photo-source.spec.ts` can pin it under plain `node --test`.
 */

/** What the avatar should show, resolved from session + cache + fetch. */
export type PhotoResolution =
  /** No photo exists for this account (or no session yet). */
  | { kind: 'none' }
  /** Show these bytes now; they came from the device cache. */
  | { kind: 'cached'; uri: string }
  /** Show these bytes; they came from the server this session. */
  | { kind: 'remote'; uri: string };

/** AsyncStorage key of one cached photo. Scoped by storage key, not user. */
export function photoCacheKey(storageKey: string): string {
  return `sbt.mobile.profile-photo.v2.${storageKey}`;
}

/**
 * The legacy per-user mirror written before the read-back existed.
 *
 * Kept only so {@link legacyPhotoCacheKey} can be *deleted* on first run:
 * it holds a camera-cache URI that may already be dangling, and nothing is
 * ever read from it again.
 */
export function legacyPhotoCacheKey(userId: string): string {
  return `sbt.mobile.profile-photo.${userId}`;
}

/**
 * Serialises a cached photo. A data URI is used rather than a file path
 * because the app ships no filesystem dependency (SDK 57 lockstep rule,
 * `docs/mobile-expo-sdk.md`) — and because a path can dangle while bytes
 * cannot.
 */
export function serializeCachedPhoto(dataUri: string): string {
  return JSON.stringify({ dataUri });
}

/** Parses a cached photo, or `null` for absent/corrupt/foreign shapes. */
export function parseCachedPhoto(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { dataUri } = parsed as { dataUri?: unknown };
    if (typeof dataUri !== 'string' || !isRenderablePhotoUri(dataUri)) return null;
    return dataUri;
  } catch {
    return null;
  }
}

/**
 * Whether a string is something `<Image source={{ uri }}>` can actually
 * render here: a data URI (the cache) or an http(s) URL. A `file://` camera
 * path is deliberately **not** accepted from storage — that is exactly the
 * value that used to rot.
 */
export function isRenderablePhotoUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  const trimmed = uri.trim();
  return /^data:image\/(jpeg|jpg|png);base64,/i.test(trimmed) || /^https?:\/\//i.test(trimmed);
}

/**
 * Resolves what to show, given the session's key and whatever is in hand.
 *
 * Order: freshly fetched bytes win, then the cache for *this* key, then
 * nothing. A cache entry belonging to a different key never wins, which is
 * what makes a replaced photo appear instead of the previous one.
 */
export function resolvePhoto(input: {
  storageKey: string | null | undefined;
  cachedForKey?: { key: string; uri: string } | null;
  fetched?: string | null;
}): PhotoResolution {
  const key = input.storageKey?.trim();
  if (!key) return { kind: 'none' };
  if (input.fetched && isRenderablePhotoUri(input.fetched)) {
    return { kind: 'remote', uri: input.fetched };
  }
  const cached = input.cachedForKey;
  if (cached && cached.key === key && isRenderablePhotoUri(cached.uri)) {
    return { kind: 'cached', uri: cached.uri };
  }
  return { kind: 'none' };
}

/** The data URI for a blob of photo bytes, as `FileReader` produces it. */
export function photoDataUri(base64: string, contentType: string): string {
  const type = contentType.toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${base64}`;
}
