import { registerAs } from '@nestjs/config';

/**
 * External push (FCM) configuration.
 *
 * `FIREBASE_SERVICE_ACCOUNT_JSON` carries the full Firebase service-account
 * JSON on a single line. When set (and valid) the API boots `FcmPushProvider`
 * and delivers OS-level push via firebase-admin; when absent the
 * `NoOpPushProvider` stays the default so local dev/CI pass without
 * credentials.
 *
 * **Security**: these values are only read here and parsed by the provider
 * factory. Never log, echo, render or persist them.
 */
export default registerAs('notifications', () => ({
  /** Firebase project id (optional; falls back to the JSON's own). */
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
  /** Full service-account JSON on one line, or null when not configured. */
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim() || null,
}));
