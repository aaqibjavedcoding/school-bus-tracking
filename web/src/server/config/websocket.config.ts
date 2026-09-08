import { registerAs } from '../framework';

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Realtime (Socket.IO) session governance.
 *
 * Long-lived socket connections outlive HTTP requests, so a deactivation that
 * lands mid-connection (user deactivated, school deactivated, access token
 * expired) is enforced by a periodic sweep —
 * `common/websocket/websocket-session-revalidation.ts`, wired together with
 * the gateways by `realtime/wireRealtimeGateways`.
 *
 * ```text
 * WEBSOCKET_SESSION_REVALIDATION_ENABLED   `false` disables the sweep (default on)
 * WEBSOCKET_SESSION_REVALIDATION_INTERVAL_MS  sweep cadence (default 5 minutes)
 * ```
 *
 * The sweep is deliberately **not** a per-event database check: an interval
 * of minutes keeps the shared DB load negligible while bounding how long a
 * revoked identity can keep receiving broadcasts. Handshake authentication
 * (every connect/reconnect verifies the full JWT + tenant state) remains the
 * authoritative gate.
 */
export default registerAs('websocket', () => ({
  sessionRevalidation: {
    enabled: process.env.WEBSOCKET_SESSION_REVALIDATION_ENABLED?.trim().toLowerCase() !== 'false',
    intervalMs: positiveInt(process.env.WEBSOCKET_SESSION_REVALIDATION_INTERVAL_MS, 5 * 60 * 1000),
  },
}));
