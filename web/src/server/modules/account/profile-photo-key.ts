/**
 * Storage-key rules for the **read** side of profile photos.
 *
 * Profile photos share one blob store with driver licences, bus RCs and
 * insurance documents (`entityType: 'profile-photos'`, see
 * `account.service.ts`). A route that serves bytes by key is therefore one
 * careless `startsWith` away from being an open reader over every tenant's
 * compliance documents, so the parsing lives here — pure, exported and
 * spec'd (`profile-photo-key.spec.ts`) — rather than inline in a handler
 * where a later edit could quietly relax it.
 *
 * Nothing in this module grants access: it only turns an untrusted URL
 * segment into a key that is *syntactically* safe and tenant-shaped. The
 * authorisation that actually matters — "a `users.profile_photo_key` row in
 * the caller's tenant references exactly this key" — is a database read in
 * `AccountService.readProfilePhotoByKey`, because a path shape can be
 * guessed and a row cannot.
 */

/** Entity folder every profile-photo key carries (mirrors the write side). */
export const PROFILE_PHOTO_KEY_SEGMENT = 'profile-photos';

/** The only content types the photo route will ever emit. */
export const PROFILE_PHOTO_SERVED_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;

export type ProfilePhotoContentType = (typeof PROFILE_PHOTO_SERVED_CONTENT_TYPES)[number];

/**
 * Rejects a segment that could escape the key space.
 *
 * Next.js has already percent-decoded the catch-all segments, so an attacker
 * cannot hide a separator behind `%2F` — but a *double* encoding (`%252F`)
 * decodes to the literal text `%2F`, which some storage back ends would treat
 * as a separator again. Both the decoded and the still-encoded forms are
 * therefore refused, together with traversal (`..`), absolute paths, Windows
 * separators, NUL/control characters and empty segments.
 */
function isUnsafeSegment(segment: string): boolean {
  if (segment.length === 0) return true;
  if (segment === '.' || segment === '..') return true;
  if (segment.includes('..')) return true;
  if (segment.includes('/') || segment.includes('\\')) return true;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(segment)) return true;
  if (/%2e%2e|%2f|%5c|%00/i.test(segment)) return true;
  return false;
}

/**
 * Normalises the catch-all route parameter into a storage key, or `null` when
 * the request is not asking for a plausible profile photo at all.
 *
 * A `null` here means the caller must answer with the same generic 404 it
 * answers an unknown key with: the shape of a key is not information this
 * route hands out either.
 */
export function normalizeProfilePhotoKey(raw: unknown): string | null {
  const segments = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('/') : null;
  if (!segments || segments.length < 2) return null;

  const parts: string[] = [];
  for (const segment of segments) {
    if (typeof segment !== 'string' || isUnsafeSegment(segment)) return null;
    parts.push(segment);
  }

  const key = parts.join('/');
  // The write side always produces `<schoolId>/profile-photos/<userId>/<file>`.
  // Refusing anything else keeps a licence or an insurance PDF from even
  // reaching the database lookup, and it costs nothing legitimate.
  if (parts[1] !== PROFILE_PHOTO_KEY_SEGMENT) return null;
  return key;
}

/**
 * True when the key sits under the caller's own tenant prefix.
 *
 * The tenant comes from the verified JWT, never from the URL; a key naming
 * another school is simply "not found" from here on. `null` (the platform
 * SUPER_ADMIN, which is not a member of any tenant) can never match.
 */
export function profilePhotoKeyBelongsToSchool(key: string, schoolId: string | null): boolean {
  if (!schoolId) return false;
  return key.startsWith(`${schoolId}/`);
}

/**
 * The content type to serve, or `null` for a blob that is not an image we
 * declared support for — a stored licence PDF, a key whose metadata the
 * provider could not read, anything surprising. Never sniffed from the bytes
 * and never echoed from the request.
 */
export function profilePhotoContentType(
  contentType: string | null | undefined,
): ProfilePhotoContentType | null {
  const normalized = (contentType ?? '').split(';')[0]?.trim().toLowerCase();
  return (
    PROFILE_PHOTO_SERVED_CONTENT_TYPES.find((allowed) => allowed === normalized) ??
    (normalized === 'image/jpg' ? 'image/jpeg' : null)
  );
}

/**
 * Validator for the response, derived from `users.profile_photo_updated_at`.
 *
 * Deriving it from the row (not from the blob's mtime) means a re-upload that
 * happens to produce identical bytes still busts every cache, and it matches
 * the `?v=` the clients append from the same column.
 */
export function profilePhotoETag(updatedAt: Date | string | null | undefined): string | null {
  if (!updatedAt) return null;
  const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
  const time = date.getTime();
  if (!Number.isFinite(time)) return null;
  return `"${time}"`;
}

/**
 * Whether the client already holds this exact version.
 *
 * `If-None-Match` may carry a list and a `W/` prefix; both are handled so a
 * conditional request from a browser cache is honoured rather than ignored.
 */
export function profilePhotoNotModified(
  ifNoneMatch: string | null | undefined,
  etag: string | null,
): boolean {
  if (!ifNoneMatch || !etag) return false;
  return ifNoneMatch
    .split(',')
    .map((candidate) => candidate.trim().replace(/^W\//, ''))
    .some((candidate) => candidate === etag || candidate === '*');
}
