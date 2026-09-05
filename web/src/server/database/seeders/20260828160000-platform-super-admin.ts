'use strict';

import type { QueryInterface, QueryOptions } from 'sequelize';
import * as bcrypt from 'bcryptjs';

/**
 * DEV SEED — platform SUPER_ADMIN bootstrap account.
 *
 * The Super Admin console (`/api/v1/admin/*` and `/admin`) is platform-level
 * and its account belongs to no school tenant (users.school_id is NULL).
 *
 * Guarantees:
 * - Idempotent: fixed UUID + `ON CONFLICT DO NOTHING`, so re-running it never duplicates.
 * - Password pattern: Password is identical to Email (`superadmin@gmail.com`).
 * - Reversible: `down` deletes the seeded row.
 */

const SUPER_ADMIN_ID = '00000000-0000-4000-8000-000000000099';
const DEFAULT_DEV_EMAIL = 'superadmin@gmail.com';
const DEFAULT_DEV_PASSWORD = 'superadmin@gmail.com';
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
        phone: '+1-555-010-9999',
        is_active: true,
        created_at: TIMESTAMP,
        updated_at: TIMESTAMP,
      },
    ],
    options,
  );

  console.log('============================================================');
  console.log('👑 PLATFORM SUPER ADMIN CREDENTIALS');
  console.log('============================================================');
  console.log('  Role:        SUPER_ADMIN');
  console.log('  School Code: (Leave blank)');
  console.log(`  Email:       ${email}`);
  console.log(`  Password:    ${password}`);
  console.log('============================================================');
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  await queryInterface.bulkDelete('users', { id: SUPER_ADMIN_ID }, {});
}
