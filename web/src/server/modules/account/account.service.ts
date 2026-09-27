import { Logger, NotFoundException } from '../../framework';
import type { AccountProfilePhotoResponse } from '@school-bus-tracking/shared-types';
import { User } from '../../database/models';
import type { UploadedSpreadsheet } from '../../http/file-response';
import type { DocumentStorageProvider } from '../documents/storage';
import {
  ACCOUNT_USER_NOT_FOUND_MESSAGE,
  PROFILE_PHOTO_ENTITY_TYPE,
} from './account.constants';
import { validateProfilePhoto, type ValidatedProfilePhoto } from './profile-photo';

/**
 * Crew self-service: the authenticated driver's or conductor's own profile
 * photo.
 *
 * Every method takes `schoolId` and `userId` from the verified JWT (never
 * from the request) and pins each query with both, so the service cannot be
 * talked into touching another crew member's account or another tenant's
 * rows — the endpoint never accepts an id to begin with.
 *
 * The bytes live in the shared document-storage provider (`LocalStorageProvider`
 * in development); this module adds only the photo-specific validation
 * (JPEG/PNG, 2 MB — see `./profile-photo`) and the two `users` columns the
 * parent portal then exposes. A photo is referenced by *storage key*, never
 * embedded in API payloads.
 */
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly users: typeof User,
    private readonly storage: DocumentStorageProvider,
  ) {}

  /**
   * Validates and stores a new profile photo for the account, replacing any
   * previously set one.
   *
   * Order: validate → store the new blob → update the row → delete the old
   * blob (best effort). Storing first means a dud upload never clobbers the
   * visible photo; deleting last keeps a failed row update from pointing at a
   * removed blob.
   */
  async setProfilePhoto(
    schoolId: string,
    userId: string,
    upload: UploadedSpreadsheet | undefined,
  ): Promise<AccountProfilePhotoResponse> {
    const photo: ValidatedProfilePhoto = validateProfilePhoto(upload);
    const user = await this.findAccount(schoolId, userId);
    const previousKey = user.profile_photo_key;

    const stored = await this.storage.store(photo.buffer, {
      schoolId,
      entityType: PROFILE_PHOTO_ENTITY_TYPE,
      entityId: user.id,
      filename: photo.fileName,
      contentType: photo.contentType,
    });

    const updatedAt = new Date();
    await user.update({
      profile_photo_key: stored.key,
      profile_photo_updated_at: updatedAt,
    });

    if (previousKey && previousKey !== stored.key) {
      await this.deleteBlobQuietly(previousKey);
    }

    return {
      id: user.id,
      profile_photo_key: stored.key,
      profile_photo_updated_at: updatedAt.toISOString(),
    };
  }

  /**
   * Clears the account's profile photo. Idempotent: clearing when none is set
   * returns the same empty state instead of an error.
   */
  async clearProfilePhoto(
    schoolId: string,
    userId: string,
  ): Promise<AccountProfilePhotoResponse> {
    const user = await this.findAccount(schoolId, userId);
    const previousKey = user.profile_photo_key;

    await user.update({ profile_photo_key: null, profile_photo_updated_at: null });

    if (previousKey) {
      await this.deleteBlobQuietly(previousKey);
    }

    return { id: user.id, profile_photo_key: null, profile_photo_updated_at: null };
  }

  /** Loads the account row inside its tenant, or throws the generic 404. */
  private async findAccount(schoolId: string, userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId, school_id: schoolId } });
    if (!user) {
      throw new NotFoundException(ACCOUNT_USER_NOT_FOUND_MESSAGE);
    }
    return user;
  }

  /**
   * Best-effort blob cleanup: a failed delete must not fail the mutation the
   * user already succeeded at (an orphaned blob is a storage concern, not an
   * API error).
   */
  private async deleteBlobQuietly(key: string): Promise<void> {
    try {
      await this.storage.delete(key);
    } catch (error) {
      this.logger.warn(
        `Failed to delete superseded profile photo blob ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
