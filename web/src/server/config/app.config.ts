import { registerAs } from '../framework';

function nonNegativeInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Public origin of this deployment, used to build absolute links the server
 * sends *out* (today: the password-reset link in the email).
 *
 * `APP_URL` wins when set. Otherwise the first `CORS_ORIGIN` entry is used —
 * that value already means "the origin a browser reaches this app on", so a
 * normal deployment needs no new variable, and a multi-origin CORS list still
 * produces one canonical link rather than a guess. Trailing slashes are
 * stripped so `https://buses.school.edu` and `https://buses.school.edu/`
 * build the identical URL.
 */
function resolveAppUrl(): string {
  const raw = process.env.APP_URL?.trim() || process.env.CORS_ORIGIN?.trim() || '';
  const first = raw.split(',')[0]?.trim() ?? '';
  const candidate = first === '' ? `http://localhost:${process.env.PORT || '3001'}` : first;
  return candidate.replace(/\/+$/, '');
}

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  /** Absolute origin used for outbound links (see {@link resolveAppUrl}). */
  appUrl: resolveAppUrl(),
  /**
   * gzip/deflate response compression. Enabled by default; set
   * `COMPRESSION_ENABLED=false` when an upstream reverse proxy already
   * performs compression. `COMPRESSION_THRESHOLD_BYTES` sets the minimum
   * body size before compression kicks in (default 1 KiB, matching the
   * `compression` middleware default).
   */
  compression: {
    enabled: process.env.COMPRESSION_ENABLED?.trim().toLowerCase() !== 'false',
    thresholdBytes: nonNegativeInt(process.env.COMPRESSION_THRESHOLD_BYTES, 1024),
  },
}));
