import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from 'node:http2';
import { Logger } from '../../../framework';
import type {
  DeviceDeliveryOutcome,
  PushDeliveryResult,
  PushNotificationPayload,
  PushNotificationProvider,
} from './notification-provider.interface';

/** Environment JSON serializable APNs configuration. */
export interface ApnsDirectOptions {
  /** PEM content of the APNs auth key (the `.p8` file body). */
  keyPem: string;
  /** Apple "Key ID" of the APNs auth key (10-char, e.g. ABC1234567). */
  keyId: string;
  /** 10-char Apple Developer Team ID. */
  teamId: string;
  /** APNs topic — the app's bundle identifier (e.g. com.schoolbustracking.app). */
  topic: string;
  /** `false` to target the APNs sandbox environment (dev builds). */
  production: boolean;
}

/** Injectable HTTP/2 request seam (unit tests; production uses node:http2). */
export type ApnsRequestFn = (
  url: string,
  headers: Record<string, string>,
  body: string,
) => Promise<{
  status: number;
  reason: string;
  error?: string;
}>;

const APNS_HOST =
  process.env.NODE_ENV !== 'production' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

/**
 * Direct Apple Push Notification service provider — iOS rail (free).
 *
 * There is **no purchasing or vendor in between**: this sends straight to
 * APNs over HTTP/2 using the ES256 provider-token flow, built on Node's
 * `node:http2` and `node:crypto` modules (no new dependency). The only
 * prerequisite is an APNs auth key (`.p8`), its Key ID, the Apple Team ID and
 * the app bundle id — all issued by Apple for any (free or paid) developer
 * account; signing an app for a real device additionally needs Apple code
 * signing, which this code never claims to bypass.
 *
 * It targets **one APNs device token per request** (APNs has no multicast),
 * so `send` loops the batch and aggregates per-device outcomes.
 */
export class ApnsDirectProvider implements PushNotificationProvider {
  readonly name = 'apns-direct';
  readonly isConfigured = true;

  private readonly logger = new Logger(ApnsDirectProvider.name);
  private token: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private readonly options: ApnsDirectOptions,
    private readonly requestFn: ApnsRequestFn = defaultApnsRequest,
  ) {}

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
    if (payload.deviceTokens.length === 0) {
      return {
        success: false,
        provider: this.name,
        error: 'No device tokens',
        retryable: false,
        delivery: { retryable: false, permanent: true },
      };
    }

    const apnsTokens: string[] = [];
    const notConfigured: string[] = [];
    payload.deviceTokens.forEach((token, index) => {
      const platform = payload.tokenPlatforms?.[index] ?? null;
      if (platform === 'android') {
        // Android FCM tokens must never be sent to APNs.
        notConfigured.push(token);
      } else {
        apnsTokens.push(token);
      }
    });

    const outcome: DeviceDeliveryOutcome = {
      delivered: [],
      retryable: [],
      invalid: [],
      notConfigured,
    };
    if (apnsTokens.length === 0) {
      return {
        success: false,
        provider: this.name,
        error: `No iOS APNs tokens to send (${notConfigured.length} Android token(s) must go through FCM)`,
        retryable: false,
        delivery: { retryable: false, permanent: true },
        deviceOutcome: outcome,
      };
    }

    try {
      for (const token of apnsTokens) {
        const result = await this.sendToOne(token, payload);
        if (result.delivered) {
          outcome.delivered.push(token);
        } else if (result.invalid) {
          outcome.invalid.push(token);
        } else {
          outcome.retryable.push(token);
        }
      }
    } catch (error) {
      // A thrown error is a provider-level (retryable) failure for every
      // remaining token; never let it escape the notification flow.
      this.logger.warn(
        `APNs send failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return this.composeResult(outcome, apnsTokens);
  }

  async sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const payload of payloads) {
      results.push(await this.send(payload));
    }
    return results;
  }

  private composeResult(outcome: DeviceDeliveryOutcome, apnsTokens: string[]): PushDeliveryResult {
    const common = {
      provider: this.name,
      messageId: `apns-${Date.now()}`,
      ...(outcome.invalid.length > 0 ? { invalidTokens: outcome.invalid } : {}),
      deviceOutcome: outcome,
    };

    if (outcome.delivered.length > 0) {
      return { ...common, success: true, retryable: false };
    }
    if (outcome.retryable.length === 0 && apnsTokens.length > 0) {
      // Nothing succeeded and nothing is retryable → permanent.
      return {
        ...common,
        success: false,
        error: 'All APNs device tokens were rejected (unregistered or invalid)',
        retryable: false,
        delivery: { retryable: false, permanent: true },
      };
    }
    return {
      ...common,
      success: false,
      error: 'APNs delivery failed (transient)',
      retryable: true,
      delivery: { retryable: true, permanent: false },
    };
  }

  /** One APNs request (HTTP/2) for one device token. */
  private async sendToOne(
    deviceToken: string,
    payload: PushNotificationPayload,
  ): Promise<{ delivered: boolean; invalid: boolean }> {
    const bearer = await this.providerToken();
    const path = `/3/device/${encodeURIComponent(deviceToken)}`;
    const headers: Record<string, string> = {
      ':method': 'POST',
      ':path': path,
      authorization: `bearer ${bearer}`,
      'apns-topic': this.options.topic,
      'apns-push-type': 'alert',
      'apns-priority': payload.priority === 'high' ? '10' : '5',
    };

    const aps: Record<string, unknown> = {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
    };
    const custom: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload.data ?? {})) {
      if (value !== null && value !== undefined) {
        custom[key] = String(value);
      }
    }
    const body = JSON.stringify({ aps, ...(Object.keys(custom).length > 0 ? custom : {}) });

    const response = await this.requestFn(`https://${APNS_HOST}${path}`, headers, body);

    if (response.status >= 200 && response.status < 300) {
      return { delivered: true, invalid: false };
    }
    if (response.status === 410) {
      // Unregistered: APNs explicitly says the token is gone.
      this.logger.warn(`APNs reported an unregistered device token (410): ${first8(deviceToken)}`);
      return { delivered: false, invalid: true };
    }
    if (response.status === 400) {
      // BadDeviceToken / BadTopic / malformed — retrying the same token
      // cannot succeed (permanent for this payload).
      this.logger.warn(`APNs rejected the payload/token (400): ${first8(deviceToken)}`);
      return { delivered: false, invalid: true };
    }
    // 403 (bad provider token), 429 (rate limit), 5xx, network → retryable.
    return { delivered: false, invalid: false };
  }

  /** ES256 provider token (cached until ~5 minutes before expiry). */
  private async providerToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(json({ alg: 'ES256', kid: this.options.keyId }));
    const claims = base64Url(json({ iss: this.options.teamId, iat: now }));
    const signingInput = `${header}.${claims}`;
    const signed = await signEcdsa(this.options.keyPem, signingInput);
    this.token = `${signingInput}.${signed}`;
    this.tokenExpiresAt = now + 50 * 60; // 50 minutes of the token's ~1h life.
    return this.token;
  }
}

/** Constructs the real APNs HTTP/2 request (production path). */
export function defaultApnsRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; reason: string; error?: string }> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const session: ClientHttp2Session = connect(target);
    session.setTimeout(5000);

    const req = session.request(
      {
        ':method': 'POST',
        ':path': headers[':path'] ?? '/',
        ...apnsHeaders(headers),
      },
      { waitForTrailers: false },
    );

    const chunks: Buffer[] = [];
    let status: number | undefined;
    req.on('response', (headers) => {
      status = statusFromHeaders(headers);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      resolve({ status: status ?? 0, reason: tryParseReason(chunks) });
      session.close();
    });
    req.on('error', (error) => {
      session.close();
      reject(error);
    });
    session.on('error', (error) => {
      reject(error);
    });
    req.end(body);
  });
}

/** Drops `http/2`-specific mapping; keeps request headers that APNs dialogs expect. */
function apnsHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(':')) continue;
    result[key] = value;
  }
  return result;
}

function statusFromHeaders(headers: IncomingHttpHeaders): number | undefined {
  const raw = headers[':status'];
  return typeof raw === 'number' ? raw : undefined;
}

/** Signs `input` with the APNs `.p8` P-256 private key (ES256). */
export async function signEcdsa(pem: string, input: string): Promise<string> {
  const { createSign } = await import('node:crypto');
  return createSign('SHA256').update(input).sign(pem, 'base64url');
}

function tryParseReason(chunks: Buffer[]): string {
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { reason?: string };
    return parsed.reason ?? '';
  } catch {
    return '';
  }
}

function first8(token: string): string {
  return `${token.slice(0, 8)}…`;
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
