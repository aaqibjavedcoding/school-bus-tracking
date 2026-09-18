import { registerAs } from '../framework';

/**
 * External push configuration (Phase 2 — platform-aware, all free).
 *
 * - **Android** — `FIREBASE_SERVICE_ACCOUNT_JSON` (full service-account JSON
 *   on one line) boots `FcmPushProvider` via `firebase-admin`. FCM delivery
 *   is free.
 * - **iOS** — `APNS_KEY_PEM` (the `.p8` auth-key body), `APNS_KEY_ID`,
 *   `APNS_TEAM_ID` and `APNS_TOPIC` (bundle id) boot `ApnsDirectProvider`,
 *   which talks straight to APNs over HTTP/2 with an ES256 provider token.
 *   Requires an Apple APNs auth key (no purchase); real-device delivery
 *   additionally needs Apple code signing. When absent, iOS devices are
 *   reported `not_configured` — never fake-delivered.
 * - **Neither** → `NoOpPushProvider` (local dev / CI pass without
 *   credentials; `push_status` = `not_configured`).
 *
 * **Security**: these values are only read here and parsed by the provider
 * factory. Never log, echo, render or persist them.
 */
export default registerAs('notifications', () => ({
  /** Firebase project id (optional; falls back to the JSON's own). */
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
  /** Full service-account JSON on one line, or null when not configured. */
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null,
  /** APNs `.p8` auth key body (PEM) for direct iOS delivery, or null. */
  apnsKeyPem: process.env.APNS_KEY_PEM?.trim() || null,
  apnsKeyId: process.env.APNS_KEY_ID?.trim() || null,
  apnsTeamId: process.env.APNS_TEAM_ID?.trim() || null,
  /** Bundle identifier the APNs key is scoped to (e.g. com.schoolbustracking.app). */
  apnsTopic: process.env.APNS_TOPIC?.trim() || null,
  /** `false` → APNs sandbox (`api.sandbox.push.apple.com`, dev builds). */
  apnsProduction: process.env.APNS_PRODUCTION?.trim().toLowerCase() !== 'false',
}));
