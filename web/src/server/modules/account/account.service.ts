import { Logger, NotFoundException } from '../../framework';
import type { AccountProfilePhotoResponse } from '@school-bus-tracking/shared-types';
import type { UserRole } from '@school-bus-tracking/shared-types';
import { User } from '../../database/models';
import type { UploadedSpreadsheet } from '../../http/file-response';
import type { DocumentStorageProvider } from '../documents/storage';
import {
  ACCOUNT_USER_NOT_FOUND_MESSAGE,
  PROFILE_PHOTO_ENTITY_TYPE,
} from './account.constants';
import { validateProfilePhoto, type ValidatedProfilePhoto } from './profile-photo';
import {
  profilePhotoContentType,
  profilePhotoETag,
  profilePhotoKeyBelongsToSchool,
  type ProfilePhotoContentType,
} from './profile-photo-key';

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
/**
 * One stored photo, ready to be written to the wire.
 *
 * `etag`/`updated_at` come from the owner's `profile_photo_updated_at`
 * column rather than from the blob, so they match the `?v=` cache-buster the
 * clients build from the session payload.
 */
export interface StoredProfilePhoto {
  key: string;
  bytes: Buffer;
  contentType: ProfilePhotoContentType;
  owner_id: string;
  owner_role: UserRole;
  etag: string | null;
  updated_at: string | null;
}

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

  /**
   * Reads a stored photo **by storage key**, inside one tenant.
   *
   * This is the authorisation decision behind `GET /crew-photos/{key}`, and
   * it is deliberately four independent checks rather than a path test:
   *
   * 1. the tenant comes from the caller's verified JWT (`schoolId` here);
   * 2. the key must sit under that tenant's prefix;
   * 3. a `users` row **in that tenant** must reference exactly this key —
   *    so a licence, an RC or an insurance PDF in the same blob store is not
   *    reachable, whatever its path looks like;
   * 4. the owner's role must be one the caller is allowed to look at
   *    (`ownerRoles`), which is how a parent can resolve a crew avatar
   *    without being able to read an administrator's photo.
   *
   * Every failure — wrong tenant, unreferenced key, missing blob, a blob that
   * is not a JPEG/PNG, a storage error — returns `null`, and the route turns
   * every `null` into the same 404. The caller is never told which check
   * failed, so probing settles nothing.
   */
  async readProfilePhotoByKey(
    schoolId: string | null,
    key: string,
    options: { ownerRoles?: readonly UserRole[] } = {},
  ): Promise<StoredProfilePhoto | null> {
    // SUPER_ADMIN has `school_id = null`: it is not a member of any tenant,
    // so there is no tenant to scope this read to and nothing is served.
    if (!schoolId || !key || !profilePhotoKeyBelongsToSchool(key, schoolId)) {
      return null;
    }

    const owner = await this.users.findOne({
      where: { school_id: schoolId, profile_photo_key: key },
    });
    if (!owner) return null;
    if (options.ownerRoles && !options.ownerRoles.includes(owner.role)) return null;

    return this.readStoredPhoto(owner);
  }

  /**
   * Reads the signed-in account's **own** photo — the `GET /account/me/photo`
   * convenience, which needs no key in the URL at all.
   */
  async readOwnProfilePhoto(schoolId: string, userId: string): Promise<StoredProfilePhoto | null> {
    if (!schoolId) return null;
    const user = await this.users.findOne({ where: { id: userId, school_id: schoolId } });
    if (!user) return null;
    return this.readStoredPhoto(user);
  }

  /** Loads the bytes a row points at, or `null` for anything unusable. */
  private async readStoredPhoto(owner: User): Promise<StoredProfilePhoto | null> {
    const key = owner.profile_photo_key;
    if (!key) return null;

    try {
      const metadata = await this.storage.getMetadata(key);
      if (!metadata?.exists) return null;

      // Declared, never sniffed: the route answers with this or with 404.
      const contentType = profilePhotoContentType(metadata.contentType);
      if (!contentType) return null;

      const bytes = await this.storage.retrieve(key);
      if (!bytes || bytes.length === 0) return null;

      return {
        key,
        bytes,
        contentType,
        owner_id: owner.id,
        owner_role: owner.role,
        etag: profilePhotoETag(owner.profile_photo_updated_at),
        updated_at: owner.profile_photo_updated_at?.toISOString() ?? null,
      };
    } catch (error) {
      // A storage failure is not an invitation to describe it: same 404.
      this.logger.warn(
        `Failed to read profile photo blob ${key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
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
