import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '../../framework';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AccountService } from './account.service';
import {
  ACCOUNT_USER_NOT_FOUND_MESSAGE,
  PROFILE_PHOTO_ENTITY_TYPE,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_REQUIRED_MESSAGE,
  PROFILE_PHOTO_TOO_LARGE_MESSAGE,
  PROFILE_PHOTO_TYPE_MESSAGE,
} from './account.constants';
import type {
  DocumentStorageProvider,
  StorageResult,
} from '../documents/storage';
import type { UploadedSpreadsheet } from '../../http/file-response';

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';

interface UserRow {
  id: string;
  school_id: string;
  role: UserRole;
  profile_photo_key: string | null;
  profile_photo_updated_at: Date | null;
}

/** A user row honouring the model's instance `update` surface. */
function makeUserRow(overrides: Partial<UserRow> = {}) {
  const row: UserRow = {
    id: DRIVER_A,
    school_id: SCHOOL_A,
    role: UserRole.DRIVER,
    profile_photo_key: null,
    profile_photo_updated_at: null,
    ...overrides,
  };
  return {
    ...row,
    update: async (values: Partial<UserRow>) => {
      Object.assign(row, values);
      return row;
    },
    snapshot: row,
  };
}

/**
 * Minimal users repository mirroring the one query the service runs:
 * `findOne({ where: { id, school_id } })`, tenant scope included.
 */
function makeUsersRepo(rows: Array<ReturnType<typeof makeUserRow>>) {
  return {
    findOne: async (query: { where: Record<string, unknown> }) =>
      rows.find(
        (row) => row.snapshot.id === query.where.id && row.snapshot.school_id === query.where.school_id,
      ) ?? null,
  };
}

/** A storage provider that records instead of touching the filesystem. */
function makeStorage() {
  const stored: Array<{ key: string; options: Record<string, unknown>; buffer: Buffer }> = [];
  const deleted: string[] = [];
  let sequence = 0;
  const provider: DocumentStorageProvider = {
    name: 'recording',
    isConfigured: true,
    store: async (buffer, options): Promise<StorageResult> => {
      sequence += 1;
      const key = `${options.schoolId}/${options.entityType}/${options.entityId}/0000000${sequence}-${options.filename}`;
      stored.push({ key, options: options as unknown as Record<string, unknown>, buffer });
      return {
        key,
        size: buffer.length,
        contentType: options.contentType,
        originalFilename: options.filename,
      };
    },
    retrieve: async () => null,
    getMetadata: async () => null,
    delete: async (key) => {
      deleted.push(key);
      return true;
    },
  };
  return { provider, stored, deleted };
}

function makeUpload(overrides: Partial<UploadedSpreadsheet> = {}): UploadedSpreadsheet {
  return {
    originalname: 'me.jpg',
    mimetype: 'image/jpeg',
    size: 1024,
    buffer: Buffer.alloc(1024, 1),
    ...overrides,
  };
}

function createService(rows: Array<ReturnType<typeof makeUserRow>> = [makeUserRow()]) {
  const storage = makeStorage();
  const service = new AccountService(makeUsersRepo(rows) as never, storage.provider);
  return { service, storage, rows };
}

describe('AccountService.setProfilePhoto — validation', () => {
  it('rejects a missing file part', async () => {
    const { service } = createService();
    await assert.rejects(
      service.setProfilePhoto(SCHOOL_A, DRIVER_A, undefined),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match((error as Error).message, new RegExp(PROFILE_PHOTO_REQUIRED_MESSAGE));
        return true;
      },
    );
  });

  it('rejects an empty file', async () => {
    const { service } = createService();
    await assert.rejects(service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload({ size: 0, buffer: Buffer.alloc(0) })), {
      message: PROFILE_PHOTO_REQUIRED_MESSAGE,
    } as object);
  });

  it('rejects anything over the 2 MB photo cap even though the provider allows 10 MB', async () => {
    const { service, storage } = createService();
    const oversized = Buffer.alloc(PROFILE_PHOTO_MAX_BYTES + 1, 1);
    await assert.rejects(
      service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload({ size: oversized.length, buffer: oversized })),
      { message: PROFILE_PHOTO_TOO_LARGE_MESSAGE } as object,
    );
    assert.equal(storage.stored.length, 0, 'nothing may reach storage');
  });

  it('rejects non-JPEG/PNG types by extension and by declared MIME type', async () => {
    const { service } = createService();
    await assert.rejects(
      service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload({ originalname: 'me.gif', mimetype: 'image/gif' })),
      { message: PROFILE_PHOTO_TYPE_MESSAGE } as object,
    );
    // A PNG file name does not rescue a bogus declared type.
    await assert.rejects(
      service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload({ originalname: 'me.png', mimetype: 'image/gif' })),
      { message: PROFILE_PHOTO_TYPE_MESSAGE } as object,
    );
    // No extension at all is not an image either.
    await assert.rejects(
      service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload({ originalname: 'me', mimetype: 'image/jpeg' })),
      { message: PROFILE_PHOTO_TYPE_MESSAGE } as object,
    );
  });

  it('accepts PNG uploads as well as JPEG', async () => {
    const { service, storage } = createService();
    const result = await service.setProfilePhoto(
      SCHOOL_A,
      DRIVER_A,
      makeUpload({ originalname: 'me.PNG', mimetype: 'image/png' }),
    );
    assert.equal(storage.stored.length, 1);
    assert.equal(result.profile_photo_key, storage.stored[0].key);
  });
});

describe('AccountService.setProfilePhoto — storage and row update', () => {
  it('stores the bytes through the shared provider under the tenant and the account', async () => {
    const { service, storage } = createService();
    await service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload());

    assert.equal(storage.stored.length, 1);
    const call = storage.stored[0];
    assert.equal(call.options.schoolId, SCHOOL_A);
    assert.equal(call.options.entityType, PROFILE_PHOTO_ENTITY_TYPE);
    assert.equal(call.options.entityId, DRIVER_A);
    assert.equal(call.options.contentType, 'image/jpeg');
    assert.match(String(call.options.filename), /\.jpg$/);
  });

  it('writes the storage key and timestamp onto the tenant-scoped account row', async () => {
    const row = makeUserRow();
    const { service } = createService([row]);
    const result = await service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload());

    assert.equal(result.id, DRIVER_A);
    assert.ok(result.profile_photo_key, 'a storage key is returned');
    assert.equal(row.snapshot.profile_photo_key, result.profile_photo_key);
    assert.equal(
      row.snapshot.profile_photo_updated_at?.toISOString(),
      result.profile_photo_updated_at,
    );
  });

  it('replaces an existing photo and deletes the superseded blob', async () => {
    const previousKey = `${SCHOOL_A}/${PROFILE_PHOTO_ENTITY_TYPE}/${DRIVER_A}/old-photo.jpg`;
    const row = makeUserRow({
      profile_photo_key: previousKey,
      profile_photo_updated_at: new Date('2026-09-01T00:00:00.000Z'),
    });
    const { service, storage } = createService([row]);
    const result = await service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload());

    assert.deepEqual(storage.deleted, [previousKey]);
    assert.notEqual(result.profile_photo_key, previousKey, 'a new blob gets a new key');
    assert.equal(row.snapshot.profile_photo_key, result.profile_photo_key);
  });
});

describe('AccountService — tenant scoping', () => {
  it('cannot resolve an account outside the JWT tenant', async () => {
    const row = makeUserRow({ school_id: SCHOOL_B });
    const { service, storage } = createService([row]);
    await assert.rejects(service.setProfilePhoto(SCHOOL_A, DRIVER_A, makeUpload()), {
      message: ACCOUNT_USER_NOT_FOUND_MESSAGE,
    } as object);
    assert.equal(storage.stored.length, 0, 'a cross-tenant miss must not reach storage');
  });

  it('cannot resolve another crew member inside the tenant either', async () => {
    const { service, storage } = createService();
    await assert.rejects(
      service.setProfilePhoto(SCHOOL_A, '09090909-0909-4909-8909-090909090909', makeUpload()),
      (error: unknown) => {
        assert.ok(error instanceof NotFoundException);
        assert.match((error as Error).message, new RegExp(ACCOUNT_USER_NOT_FOUND_MESSAGE));
        return true;
      },
    );
    assert.equal(storage.stored.length, 0);
  });

  it('clears refuse to touch another tenant’s row', async () => {
    const row = makeUserRow({
      school_id: SCHOOL_B,
      profile_photo_key: 'school-b/photo.jpg',
      profile_photo_updated_at: new Date(),
    });
    const { service, storage } = createService([row]);
    await assert.rejects(service.clearProfilePhoto(SCHOOL_A, DRIVER_A), {
      message: ACCOUNT_USER_NOT_FOUND_MESSAGE,
    } as object);
    assert.deepEqual(storage.deleted, []);
    assert.equal(row.snapshot.profile_photo_key, 'school-b/photo.jpg');
  });
});

describe('AccountService.clearProfilePhoto', () => {
  it('nulls both columns, deletes the blob and reports the empty state', async () => {
    const row = makeUserRow({
      profile_photo_key: `${SCHOOL_A}/${PROFILE_PHOTO_ENTITY_TYPE}/${DRIVER_A}/me.jpg`,
      profile_photo_updated_at: new Date('2026-09-20T00:00:00.000Z'),
    });
    const { service, storage } = createService([row]);
    const result = await service.clearProfilePhoto(SCHOOL_A, DRIVER_A);

    assert.deepEqual(result, { id: DRIVER_A, profile_photo_key: null, profile_photo_updated_at: null });
    assert.equal(row.snapshot.profile_photo_key, null);
    assert.equal(row.snapshot.profile_photo_updated_at, null);
    assert.deepEqual(storage.deleted, [
      `${SCHOOL_A}/${PROFILE_PHOTO_ENTITY_TYPE}/${DRIVER_A}/me.jpg`,
    ]);
  });

  it('is idempotent: clearing an account without a photo deletes nothing', async () => {
    const { service, storage } = createService();
    const result = await service.clearProfilePhoto(SCHOOL_A, DRIVER_A);

    assert.deepEqual(result, { id: DRIVER_A, profile_photo_key: null, profile_photo_updated_at: null });
    assert.deepEqual(storage.deleted, []);
  });
});
