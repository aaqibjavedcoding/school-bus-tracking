'use strict';

import type { QueryInterface, QueryOptions } from 'sequelize';
import bcrypt from 'bcryptjs';

/**
 * DEV SEED — platform SUPER_ADMIN bootstrap account.
 *
 * The Super Admin console (`/api/v1/admin/*`) is platform-level and its
 * account belongs to no school tenant (users.school_id is NULL — see the
 * accompanying migration). This seeder bootstraps exactly one such account
 * for local development and smoke testing.
 *
 * Guarantees:
 * - **Idempotent**: fixed UUID + `ON CONFLICT DO NOTHING`, so re-running it
 *   never duplicates or fails.
 * - **No plaintext password at rest**: the password is bcrypt-hashed here
 *   before insert.
 * - **Refuses production** unless both SUPER_ADMIN_EMAIL and
 *   SUPER_ADMIN_PASSWORD are explicitly supplied through the environment
 *   (a platform account with a known default password must never reach
 *   production).
 * - **Reversible**: `down` deletes exactly the single seeded row.
 */

const SUPER_ADMIN_ID = '00000000-0000-4000-8000-000000000099';
const DEFAULT_DEV_EMAIL = 'superadmin@platform.test';
const DEFAULT_DEV_PASSWORD = 'super-admin-password';
const TIMESTAMP = new Date('2026-08-28T00:00:00.000Z');

const options: QueryOptions & { ignoreDuplicates?: boolean } = { ignoreDuplicates: true };

export async function up(queryInterface: QueryInterface): Promise<void> {
  const email = (process.env.SUPER_ADMIN_EMAIL || DEFAULT_DEV_EMAIL).trim().toLowerCase();
  const password = process.env.SUPER_ADMIN_PASSWORD || DEFAULT_DEV_PASSWORD;

  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SUPER_ADMIN_EMAIL || !process.env.SUPER_ADMIN_PASSWORD) {
      throw new Error(
        'Refusing to seed the platform super admin in production without explicit SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD.',
      );
    }
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await queryInterface.bulkInsert(
    'users',
    [
      {
        id: SUPER_ADMIN_ID,
        school_id: null,
        role: 'SUPER_ADMIN',
        first_name: 'Platform',
        last_name: 'Administrator',
        email,
        password_hash: passwordHash,
        email_verified_at: TIMESTAMP,
        phone: null,
        is_active: true,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      },
    ],
    options,
  );
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.bulkDelete('users', { id: SUPER_ADMIN_ID }, {});
}
