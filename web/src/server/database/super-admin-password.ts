export const SUPER_ADMIN_ROLE_VALUE = 'SUPER_ADMIN' as const;
export const SUPER_ADMIN_PASSWORD_MIN_LENGTH = 16;

export interface SuperAdminPasswordMatch {
  id: string;
}

export interface SuperAdminPasswordRotationStore {
  findSuperAdminsByEmail(email: string): Promise<readonly SuperAdminPasswordMatch[]>;
  updatePasswordHash(id: string, email: string, passwordHash: string): Promise<number>;
}

/** Normalize the platform login address consistently across seeding and rotation. */
export function normalizeSuperAdminEmail(value: string | undefined): string {
  const email = value?.trim().toLowerCase() ?? '';
  if (!email) {
    throw new Error('SUPER_ADMIN_EMAIL is required.');
  }
  return email;
}

/** Shared password policy for the platform-admin seeder and rotation command. */
export function validateSuperAdminPassword(email: string, password: string): void {
  if (Array.from(password).length < SUPER_ADMIN_PASSWORD_MIN_LENGTH) {
    throw new Error('The platform super-admin password must be at least 16 characters.');
  }

  if (password.trim().toLowerCase() === email.trim().toLowerCase()) {
    throw new Error('The platform super-admin password must not equal the email address.');
  }
}

/**
 * Update only after finding exactly one matching platform account. The caller
 * wraps the store operations in a transaction so cardinality errors roll back.
 */
export async function updatePasswordHashForExactlyOneSuperAdmin(
  store: SuperAdminPasswordRotationStore,
  email: string,
  passwordHash: string,
): Promise<void> {
  const matches = await store.findSuperAdminsByEmail(email);
  if (matches.length !== 1) {
    throw new Error('Expected exactly one matching SUPER_ADMIN account.');
  }

  const updated = await store.updatePasswordHash(matches[0].id, email, passwordHash);
  if (updated !== 1) {
    throw new Error('Expected exactly one SUPER_ADMIN account to be updated.');
  }
}
