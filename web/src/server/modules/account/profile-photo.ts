/**
 * Photo-specific validation around the generic multipart upload.
 *
 * Kept free of HTTP and storage concerns so the rules (JPEG/PNG only, max
 * 2 MB) are unit-testable in isolation, exactly like the import module's
 * `requireSpreadsheet` rules are. The multipart plumbing itself is the
 * shared `parseUploadedSpreadsheet` from `http/file-response` — the upload
 * envelopes the API accepts are identical for every module; only the file
 * constraints differ, and those live here.
 */
import { BadRequestException } from '../../framework';
import type { UploadedSpreadsheet } from '../../http/file-response';
import {
  PROFILE_PHOTO_ALLOWED_EXTENSIONS,
  PROFILE_PHOTO_ALLOWED_MIME_TYPES,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_REQUIRED_MESSAGE,
  PROFILE_PHOTO_TOO_LARGE_MESSAGE,
  PROFILE_PHOTO_TYPE_MESSAGE,
} from './account.constants';

/** A photo that passed validation, ready to hand to the storage provider. */
export interface ValidatedProfilePhoto {
  /** Sanitised-extension file name the provider keys the blob with. */
  fileName: string;
  contentType: string;
  buffer: Buffer;
}

/**
 * Validates the uploaded file against the photo constraints.
 *
 * A missing/empty part, an oversized payload, a non-JPEG/PNG extension or a
 * mismatched declared type all reject with a 400 whose message the crew app
 * can show verbatim. Note the extension *and* the declared MIME type are both
 * checked — either alone is client-controlled noise, together they rule out
 * the usual "renamed script" mistakes the provider's own allowlist then
 * double-guards.
 */
export function validateProfilePhoto(
  file: UploadedSpreadsheet | undefined,
): ValidatedProfilePhoto {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException(PROFILE_PHOTO_REQUIRED_MESSAGE);
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES || file.buffer.length > PROFILE_PHOTO_MAX_BYTES) {
    throw new BadRequestException(PROFILE_PHOTO_TOO_LARGE_MESSAGE);
  }

  const name = (file.originalname || 'photo').toLowerCase();
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  if (!(PROFILE_PHOTO_ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new BadRequestException(PROFILE_PHOTO_TYPE_MESSAGE);
  }
  if (!PROFILE_PHOTO_ALLOWED_MIME_TYPES.has(file.mimetype ?? '')) {
    throw new BadRequestException(PROFILE_PHOTO_TYPE_MESSAGE);
  }

  const contentType = file.mimetype;
  return {
    // The provider sanitises and keys blobs; the extension is all the name
    // needs to carry for a self-service avatar.
    fileName: `photo${extension}`,
    contentType,
    buffer: file.buffer,
  };
}
