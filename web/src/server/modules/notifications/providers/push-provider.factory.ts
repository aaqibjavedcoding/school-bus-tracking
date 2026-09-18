import { Logger } from '../../../framework';
import type { PushNotificationProvider } from './notification-provider.interface';
import { FcmPushProvider } from './fcm-push.provider';
import { ApnsDirectProvider, type ApnsDirectOptions } from './apns-direct.provider';
import { PushDeliveryRouter } from './push-delivery-router';
import { NoOpPushProvider } from './noop-push.provider';

/**
 * Push provider selection (Phase 2 — platform-aware).
 *
 * Builds the composite {@link PushDeliveryRouter} when at least one real
 * provider is configured:
 *
 * - `FIREBASE_SERVICE_ACCOUNT_JSON` (set and valid JSON) → Android FCM.
 * - `APNS_KEY_PEM` + `APNS_KEY_ID` + `APNS_TEAM_ID` + `APNS_TOPIC`
 *   (all set and a well-formed key) → iOS direct APNs.
 *
 * When neither is configured the `NoOpPushProvider` remains the default, so
 * local dev and CI without credentials keep every suite green. A configured
 * rail that fails to parse falls back to "that rail unavailable" with a
 * warning — never to a silent success. Credential values are never logged or
 * echoed; only the absence/invalidity of a configuration is reported.
 */
export function createPushProvider(options: {
  serviceAccountJson?: string | null;
  projectId?: string | null;
  apnsKeyPem?: string | null;
  apnsKeyId?: string | null;
  apnsTeamId?: string | null;
  apnsTopic?: string | null;
  apnsProduction?: boolean | null;
}): PushNotificationProvider {
  const logger = new Logger('PushProviderSelection');

  const fcm = buildFcm(options, logger);
  const apns = buildApns(options, logger);

  if (!fcm && !apns) {
    return new NoOpPushProvider();
  }
  return new PushDeliveryRouter(fcm, apns);
}

function buildFcm(
  options: { serviceAccountJson?: string | null; projectId?: string | null },
  logger: Logger,
): FcmPushProvider | null {
  const raw = options.serviceAccountJson?.trim();
  if (!raw) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn(
      'FIREBASE_SERVICE_ACCOUNT_JSON is set but is not valid JSON — Android FCM is disabled. Check the variable (its value is never logged).',
    );
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    logger.warn(
      'FIREBASE_SERVICE_ACCOUNT_JSON is set but is not a service-account object — Android FCM is disabled.',
    );
    return null;
  }
  return new FcmPushProvider(parsed as Record<string, unknown>, options.projectId?.trim() || null);
}

function buildApns(
  options: {
    apnsKeyPem?: string | null;
    apnsKeyId?: string | null;
    apnsTeamId?: string | null;
    apnsTopic?: string | null;
    apnsProduction?: boolean | null;
  },
  logger: Logger,
): ApnsDirectProvider | null {
  const keyPem = options.apnsKeyPem?.trim();
  const keyId = options.apnsKeyId?.trim();
  const teamId = options.apnsTeamId?.trim();
  const topic = options.apnsTopic?.trim();

  if (!keyPem && !keyId && !teamId && !topic) {
    return null; // APNs not configured — iOS devices report not_configured.
  }
  if (!keyPem || !keyId || !teamId || !topic) {
    logger.warn(
      'APNs configuration is incomplete (APNS_KEY_PEM, APNS_KEY_ID, APNS_TEAM_ID and APNS_TOPIC are all required) — iOS direct APNs is disabled.',
    );
    return null;
  }
  if (!looksLikePem(keyPem)) {
    logger.warn(
      'APNS_KEY_PEM is set but does not look like a PEM key — iOS direct APNs is disabled. (The value is never logged.)',
    );
    return null;
  }
  const apnsOptions: ApnsDirectOptions = {
    keyPem,
    keyId,
    teamId,
    topic,
    production: options.apnsProduction ?? true,
  };
  return new ApnsDirectProvider(apnsOptions);
}

function looksLikePem(value: string): boolean {
  return value.includes('-----BEGIN');
}
