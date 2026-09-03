import { registerAs } from '@nestjs/config';

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3001', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  /**
   * gzip/deflate response compression. Enabled by default; set
   * `COMPRESSION_ENABLED=false` when an upstream reverse proxy already
   * performs compression. `COMPRESSION_THRESHOLD_BYTES` sets the minimum
   * body size before compression kicks in (default 1 KiB, matching the
   * `compression` middleware default).
   */
  compression: {
    enabled: process.env.COMPRESSION_ENABLED?.trim().toLowerCase() !== 'false',
    thresholdBytes: positiveInt(process.env.COMPRESSION_THRESHOLD_BYTES, 1024),
  },
}));
