import { registerAs } from '@nestjs/config';

/**
 * JWT signing and session configuration. The secret and token lifetime always
 * come from the environment — they are never hard-coded in application code.
 *
 * A development-only fallback secret keeps local bootstraps friction-free,
 * but production refuses to start without an explicit `JWT_SECRET`.
 */
export default registerAs('jwt', () => {
  const secret = process.env.JWT_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set in production environments');
  }

  return {
    secret: secret || 'dev-only-jwt-secret-change-me',
    /** Access token lifetime, in any `ms`-compatible format (e.g. `15m`, `1h`). */
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
    /** Refresh token lifetime, in any `ms`-compatible format (e.g. `7d`, `30d`). */
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    /** Name of the httpOnly cookie carrying the refresh token. */
    refreshCookieName: process.env.REFRESH_TOKEN_COOKIE_NAME || 'refresh_token',
  };
});
