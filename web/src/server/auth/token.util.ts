import * as crypto from 'crypto';

/** Default lifetime for refresh tokens: 7 days in milliseconds. */
export const DEFAULT_REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Generates a cryptographically secure random opaque token string.
 * Uses 32 random bytes (256 bits of entropy) formatted as 64-character hexadecimal.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Computes a deterministic SHA-256 hash of a raw token for database storage
 * and fast indexed lookup.
 *
 * High-entropy random tokens (256 bits) cannot be reversed via dictionary or
 * brute-force attacks even if the database is compromised.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Parses a duration string (e.g. '15m', '1h', '7d', '30d') or numeric seconds into milliseconds.
 */
export function parseDurationToMs(
  duration: string | number | undefined,
  defaultMs: number = DEFAULT_REFRESH_TOKEN_TTL_MS,
): number {
  if (duration === undefined || duration === null || duration === '') {
    return defaultMs;
  }
  if (typeof duration === 'number') {
    return duration > 0 ? duration * 1000 : defaultMs;
  }
  const match = /^(\d+)\s*([smhdw]?)$/i.exec(duration.trim());
  if (!match) {
    return defaultMs;
  }
  const value = parseInt(match[1], 10);
  if (isNaN(value) || value <= 0) {
    return defaultMs;
  }
  const unit = (match[2] || 's').toLowerCase();
  switch (unit) {
    case 's':
      return value * 1000;
    case 'm':
      return value * 60 * 1000;
    case 'h':
      return value * 60 * 60 * 1000;
    case 'd':
      return value * 24 * 60 * 60 * 1000;
    case 'w':
      return value * 7 * 24 * 60 * 60 * 1000;
    default:
      return defaultMs;
  }
}

/**
 * Parses standard HTTP `Cookie` header into a key-value record.
 */
export function parseCookieHeader(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return {};
  }
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) {
      cookies[key] = decodeURIComponent(val);
    }
  }
  return cookies;
}
