import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSuperAdminEmail,
  updatePasswordHashForExactlyOneSuperAdmin,
  validateSuperAdminPassword,
} from './super-admin-password';

describe('platform super-admin password rotation', () => {
  it('normalizes the account email before it is used for matching', () => {
    assert.equal(normalizeSuperAdminEmail('  Admin@Example.Test  '), 'admin@example.test');
    assert.throws(() => normalizeSuperAdminEmail('  '), /SUPER_ADMIN_EMAIL is required/);
  });

  it('enforces the shared minimum-length and email-inequality rules', () => {
    const email = 'admin@example.test';
    assert.throws(
      () => validateSuperAdminPassword(email, 'x'.repeat(15)),
      /at least 16 characters/,
    );
    assert.throws(
      () => validateSuperAdminPassword(email, email.toUpperCase()),
      /must not equal the email/,
    );
    assert.doesNotThrow(() => validateSuperAdminPassword(email, 'x'.repeat(16)));
  });

  it('updates only one matching platform account', async () => {
    const calls: Array<{ id: string; email: string; passwordHash: string }> = [];
    const store = {
      async findSuperAdminsByEmail(email: string) {
        assert.equal(email, 'admin@example.test');
        return [{ id: 'platform-user-id' }];
      },
      async updatePasswordHash(id: string, email: string, passwordHash: string) {
        calls.push({ id, email, passwordHash });
        return 1;
      },
    };

    await updatePasswordHashForExactlyOneSuperAdmin(
      store,
      'admin@example.test',
      'test-hash-placeholder',
    );
    assert.deepEqual(calls, [
      {
        id: 'platform-user-id',
        email: 'admin@example.test',
        passwordHash: 'test-hash-placeholder',
      },
    ]);
  });

  it('aborts without updating when zero or multiple accounts match', async () => {
    for (const matches of [[], [{ id: 'first' }, { id: 'second' }]]) {
      let updateCalled = false;
      const store = {
        async findSuperAdminsByEmail() {
          return matches;
        },
        async updatePasswordHash() {
          updateCalled = true;
          return 1;
        },
      };

      await assert.rejects(
        updatePasswordHashForExactlyOneSuperAdmin(
          store,
          'admin@example.test',
          'test-hash-placeholder',
        ),
        /Expected exactly one matching SUPER_ADMIN account/,
      );
      assert.equal(updateCalled, false);
    }
  });

  it('aborts if the guarded update does not affect exactly one account', async () => {
    const store = {
      async findSuperAdminsByEmail() {
        return [{ id: 'platform-user-id' }];
      },
      async updatePasswordHash() {
        return 0;
      },
    };

    await assert.rejects(
      updatePasswordHashForExactlyOneSuperAdmin(
        store,
        'admin@example.test',
        'test-hash-placeholder',
      ),
      /Expected exactly one SUPER_ADMIN account to be updated/,
    );
  });
});
