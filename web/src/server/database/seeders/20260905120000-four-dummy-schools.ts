'use strict'

import type { QueryInterface, QueryOptions } from 'sequelize'
import * as bcrypt from 'bcryptjs'

/**
 * SEEDER — 4 Dummy Schools with Admin Users
 *
 * Adds 4 independent tenant schools, each with an admin user.
 * Idempotent (ON CONFLICT DO NOTHING), safe to re-run.
 * No plaintext passwords stored at rest — bcrypt hashes only.
 * Refuses to run in production.
 *
 * Usernames (emails) and plaintext passwords for developer reference:
 *   1. Green Valley Admin: admin@green-valley.test / school-A-pass123
 *   2. Riverside Admin:    admin@riverside-public.test / school-B-pass123
 *   3. Oakwood Admin:      admin@oakwood-academy.test / school-C-pass123
 *   4. Maple Leaf Admin:   admin@maple-leaf-central.test / school-D-pass123
 */

// Plaintext passwords — only used for bcrypt hashing in `up()`, never stored at rest
const PLAINTEXT_PASSWORDS = {
  SCHOOL_A: 'school-A-pass123',
  SCHOOL_B: 'school-B-pass123',
  SCHOOL_C: 'school-C-pass123',
  SCHOOL_D: 'school-D-pass123',
}

// Unique UUIDs per school + admin user
const SCHOOL_IDS = {
  SCHOOL_A: '00000000-0000-4000-8000-000000000101',
  SCHOOL_B: '00000000-0000-4000-8000-000000000102',
  SCHOOL_C: '00000000-0000-4000-8000-000000000103',
  SCHOOL_D: '00000000-0000-4000-8000-000000000104',
}

const ADMIN_USERS = {
  SCHOOL_A: '00000000-0000-4000-8000-000000000201',
  SCHOOL_B: '00000000-0000-4000-8000-000000000202',
  SCHOOL_C: '00000000-0000-4000-8000-000000000203',
  SCHOOL_D: '00000000-0000-4000-8000-000000000204',
}

// School data payloads
const SCHOOLS = [
  {
    id: SCHOOL_IDS.SCHOOL_A,
    name: 'Green Valley International School',
    code: 'green-valley',
    subdomain: 'green-valley',
    email: 'admin@green-valley.test',
    phone: '+91-9876543210',
    address_line1: '123 Education Avenue',
    address_line2: 'Block B',
    city: 'Mumbai',
    state: 'Maharashtra',
    postal_code: '400001',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 19.0761,
    longitude: 72.8777,
    is_active: true,
  },
  {
    id: SCHOOL_IDS.SCHOOL_B,
    name: 'Riverside Public School',
    code: 'riverside-public',
    subdomain: 'riverside-public',
    email: 'admin@riverside-public.test',
    phone: '+91-9876543211',
    address_line1: '45 River Road',
    address_line2: 'Sector 17',
    city: 'Delhi',
    state: 'Delhi',
    postal_code: '110001',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 28.7041,
    longitude: 77.1025,
    is_active: true,
  },
  {
    id: SCHOOL_IDS.SCHOOL_C,
    name: 'Oakwood Academy',
    code: 'oakwood-academy',
    subdomain: 'oakwood-academy',
    email: 'admin@oakwood-academy.test',
    phone: '+91-9876543212',
    address_line1: '78 Learning Street',
    address_line2: 'Wing C',
    city: 'Bangalore',
    state: 'Karnataka',
    postal_code: '560001',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 12.9716,
    longitude: 77.5946,
    is_active: true,
  },
  {
    id: SCHOOL_IDS.SCHOOL_D,
    name: 'Maple Leaf Central School',
    code: 'maple-leaf-central',
    subdomain: 'maple-leaf-central',
    email: 'admin@maple-leaf-central.test',
    phone: '+91-9876543213',
    address_line1: '99 Campus Lane',
    address_line2: 'Floor 2',
    city: 'Chennai',
    state: 'Tamil Nadu',
    postal_code: '600001',
    country: 'IN',
    timezone: 'Asia/Kolkata',
    latitude: 13.0827,
    longitude: 80.2700,
    is_active: true,
  },
]

// Admin user data (password_hash will be set inside `up()`)
const ADMINS = [
  {
    id: ADMIN_USERS.SCHOOL_A,
    school_id: SCHOOL_IDS.SCHOOL_A,
    role: 'SCHOOL_ADMIN',
    first_name: 'Anil',
    last_name: 'Kumar',
    email: 'admin@green-valley.test',
    password_hash: null, // will be set after bcrypt
    email_verified_at: new Date('2026-09-05T00:00:00.000Z'),
    phone: '+91-9876543210',
    is_active: true,
  },
  {
    id: ADMIN_USERS.SCHOOL_B,
    school_id: SCHOOL_IDS.SCHOOL_B,
    role: 'SCHOOL_ADMIN',
    first_name: 'Priya',
    last_name: 'Sharma',
    email: 'admin@riverside-public.test',
    password_hash: null,
    email_verified_at: new Date('2026-09-05T00:00:00.000Z'),
    phone: '+91-9876543211',
    is_active: true,
  },
  {
    id: ADMIN_USERS.SCHOOL_C,
    school_id: SCHOOL_IDS.SCHOOL_C,
    role: 'SCHOOL_ADMIN',
    first_name: 'Rahul',
    last_name: 'Verma',
    email: 'admin@oakwood-academy.test',
    password_hash: null,
    email_verified_at: new Date('2026-09-05T00:00:00.000Z'),
    phone: '+91-9876543212',
    is_active: true,
  },
  {
    id: ADMIN_USERS.SCHOOL_D,
    school_id: SCHOOL_IDS.SCHOOL_D,
    role: 'SCHOOL_ADMIN',
    first_name: 'Sneha',
    last_name: 'Patel',
    email: 'admin@maple-leaf-central.test',
    password_hash: null,
    email_verified_at: new Date('2026-09-05T00:00:00.000Z'),
    phone: '+91-9876543213',
    is_active: true,
  },
]

export async function up(queryInterface: QueryInterface): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to insert dummy school data into a production database.')
  }

  // Hash passwords in parallel
  const passwordHashes: Record<string, string> = {}
  const hashPromises: Promise<void>[] = []

  for (const [key, pass] of Object.entries(PLAINTEXT_PASSWORDS)) {
    hashPromises.push(
      (async () => {
        passwordHashes[key] = await bcrypt.hash(pass, 12)
      })()
    )
  }
  await Promise.all(hashPromises)

  const options: QueryOptions & { ignoreDuplicates?: boolean } = { ignoreDuplicates: true }

  // 1. Insert schools
  await queryInterface.bulkInsert('schools', SCHOOLS, options)

  // 2. Attach hashed passwords to admin objects and insert users
  const adminsWithHash = ADMINS.map((admin, index) => {
    const schoolKey = Object.keys({ SCHOOL_A: 'SCHOOL_A', SCHOOL_B: 'SCHOOL_B', SCHOOL_C: 'SCHOOL_C', SCHOOL_D: 'SCHOOL_D' })[index]
    return {
      ...admin,
      password_hash: passwordHashes[schoolKey],
    }
  })

  await queryInterface.bulkInsert('users', adminsWithHash, options)

  // 3. Output credentials for the user
  console.log('✅ 4 dummy schools and admin users seeded successfully.')
  console.log('🔑 Usernames (emails) and passwords:')
  console.log('   1. Green Valley Admin: admin@green-valley.test / school-A-pass123')
  console.log('   2. Riverside Admin:    admin@riverside-public.test / school-B-pass123')
  console.log('   3. Oakwood Admin:      admin@oakwood-academy.test / school-C-pass123')
  console.log('   4. Maple Leaf Admin:   admin@maple-leaf-central.test / school-D-pass123')
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // Delete users per school (school_id foreign key)
  await queryInterface.bulkDelete('users', { school_id: SCHOOL_IDS.SCHOOL_A }, {})
  await queryInterface.bulkDelete('users', { school_id: SCHOOL_IDS.SCHOOL_B }, {})
  await queryInterface.bulkDelete('users', { school_id: SCHOOL_IDS.SCHOOL_C }, {})
  await queryInterface.bulkDelete('users', { school_id: SCHOOL_IDS.SCHOOL_D }, {})

  // Delete schools
  await queryInterface.bulkDelete('schools', { id: SCHOOL_IDS.SCHOOL_A }, {})
  await queryInterface.bulkDelete('schools', { id: SCHOOL_IDS.SCHOOL_B }, {})
  await queryInterface.bulkDelete('schools', { id: SCHOOL_IDS.SCHOOL_C }, {})
  await queryInterface.bulkDelete('schools', { id: SCHOOL_IDS.SCHOOL_D }, {})
}