import * as bcrypt from 'bcryptjs';

/**
 * Production-grade bcrypt work factor. 12 is the current industry baseline:
 * expensive enough to slow offline attacks, cheap enough for interactive login.
 */
export const BCRYPT_COST_FACTOR = 12;

/**
 * Hashes a plaintext password. Never log `password` or the returned hash.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Constant-time comparison of a plaintext password against a stored hash.
 * Never log either argument.
 */
export async function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

/**
 * Tenant-agnostic email normalization used whenever credentials are stored
 * or looked up: trim surrounding whitespace and lowercase.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
