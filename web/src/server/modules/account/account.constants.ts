/**
 * Limits and user-facing messages for crew account self-service uploads.
 *
 * The stored bytes go through the shared document-storage provider (see
 * `./account.service`); the limits here are the *photo-specific* tightening
 * the account module applies on top of the provider's own 10 MB /
 * extension allowlist — a profile photo is a small JPEG or PNG, nothing else.
 */

/** Hard upload cap for a profile photo: 2 MB. */
export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

/** Declared content types accepted for a profile photo. */
export const PROFILE_PHOTO_ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png']);

/** File-name extensions accepted for a profile photo. */
export const PROFILE_PHOTO_ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];

/** Entity folder the storage provider groups profile photos under. */
export const PROFILE_PHOTO_ENTITY_TYPE = 'profile-photos';

/** Multipart field the photo is uploaded in (`file`, like every upload here). */
export const PROFILE_PHOTO_FIELD = 'file';

/** Returned when the multipart request carried no usable file part. */
export const PROFILE_PHOTO_REQUIRED_MESSAGE = 'Please attach a profile photo.';

/** Returned when the upload exceeds the 2 MB cap. */
export const PROFILE_PHOTO_TOO_LARGE_MESSAGE = 'Profile photos must be at most 2 MB.';

/** Returned when the upload is not a JPEG or PNG image. */
export const PROFILE_PHOTO_TYPE_MESSAGE = 'Profile photos must be a JPEG or PNG image.';

/**
 * Generic not-found for the photo's owner. Deliberately identical for "row
 * gone" and "row of another tenant" — the same rule the document services
 * follow — so probing settles nothing.
 */
export const ACCOUNT_USER_NOT_FOUND_MESSAGE = 'User not found';

/**
 * The single answer the photo-serving route gives to **every** failure:
 * unknown key, another tenant's key, a key that belongs to a licence rather
 * than a photo, a blob that is gone, a traversal attempt. Identical status,
 * identical body — probing a key settles nothing.
 */
export const PROFILE_PHOTO_NOT_FOUND_MESSAGE = 'Photo not found';
