import { connect, type ClientHttp2Session, type IncomingHttpHeaders } from 'node:http2';
import { Logger } from '../../../framework';
import {
  emptyDeviceOutcome,
  type DeviceDeliveryOutcome,
  type PushDeliveryResult,
  type PushNotificationPayload,
  type PushNotificationProvider,
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
  /**
   * `true` → `api.push.apple.com` (TestFlight/App Store builds), `false` →
   * `api.sandbox.push.apple.com` (development builds). This is the **only**
   * host selector: it comes from the provider's configuration
   * (`APNS_PRODUCTION`), never from `NODE_ENV`, because an app's APNs
   * environment is decided by how it was signed, not by where the API server
   * happens to be deployed.
   */
  production: boolean;
  /** Per-request deadline in ms (default {@link DEFAULT_APNS_TIMEOUT_MS}). */
  requestTimeoutMs?: number;
}

/** Injectable HTTP/2 request seam (unit tests; production uses node:http2). */
export type ApnsRequestFn = (
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
) => Promise<{
  status: number;
  reason: string;
  error?: string;
}>;

/** Hard ceiling for one APNs request (connection + response). */
export const DEFAULT_APNS_TIMEOUT_MS = 10_000;

/** APNs production host (App Store / TestFlight signed builds). */
export const APNS_PRODUCTION_HOST = 'api.push.apple.com';
/** APNs sandbox host (development-signed builds). */
export const APNS_SANDBOX_HOST = 'api.sandbox.push.apple.com';

/** Provider token refresh margin: refresh well before Apple's 1-hour limit. */
export const APNS_TOKEN_TTL_MS = 50 * 60 * 1000;

/** The app's APNs host, chosen from the explicit provider configuration. */
export function apnsHost(production: boolean): string {
  return production ? APNS_PRODUCTION_HOST : APNS_SANDBOX_HOST;
}

/**
 * How one APNs response maps onto the per-device outcome buckets.
 *
 * - `accepted`        — APNs took the message (2xx). Acceptance ≠ display.
 * - `invalid-token`   — the *device token* is gone/never valid → retire it.
 * - `retryable`       — transient (rate limit, provider blip, expired
 *                       provider token, network) → retry the same device.
 * - `permanent`       — the *message* is refused for good (payload/priority/
 *                       expiration) → terminal, token untouched.
 * - `misconfigured`   — the *rail* is wrong (bad/rotated credentials, wrong
 *                       topic/certificate environment) → terminal, and
 *                       critically **no token is retired**: a mistyped
 *                       `APNS_TOPIC` must never deactivate the fleet.
 */
export type ApnsReasonClass =
  'accepted' | 'invalid-token' | 'retryable' | 'permanent' | 'misconfigured';

/** Device-token reasons that mean "this token can never work again". */
const APNS_INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'Unregistered']);

/**
 * Reasons that mean the *message* is unusable as-is (payload/priority/
 * expiration): retrying the same body cannot help, but the device token is
 * perfectly fine and must not be retired.
 * (https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)
 */
const APNS_PERMANENT_MESSAGE_REASONS = new Set([
  'PayloadEmpty',
  'PayloadTooLarge',
  'BadCollapseId',
  'BadMessageId',
  'BadPriority',
  'BadExpirationDate',
]);

/**
 * Reasons that mean the *rail* is wrong (credentials, topic, certificate
 * environment, request shape). Terminal for the attempt, and — critically —
 * never a reason to retire a device token.
 */
const APNS_MISCONFIGURATION_REASONS = new Set([
  'InvalidProviderToken',
  'MissingProviderToken',
  'BadTopic',
  'MissingTopic',
  'TopicDisallowed',
  'InvalidTopicSize',
  'BadPath',
  'MethodNotAllowed',
  'DuplicateHeaders',
  'MissingDeviceToken',
  'BadCertificate',
  'BadCertificateEnvironment',
  // Either the configured topic is wrong for this token or the token belongs
  // to a different bundle id; both must be fixed by an operator, not by
  // deleting the fleet's device tokens.
  'DeviceTokenNotForTopic',
]);

/** Reasons where a fresh provider token (and a retry) is the right reaction. */
const APNS_PROVIDER_TOKEN_REFRESH_REASONS = new Set([
  'ExpiredProviderToken',
  'InvalidProviderToken',
  'TooManyProviderTokenUpdates',
]);

/** Reasons that are explicitly transient. */
const APNS_RETRYABLE_REASONS = new Set([
  'ServiceUnavailable',
  'InternalServerError',
  'Shutdown',
  'TooManyRequests',
  'ExpiredProviderToken',
  'IdleTimeout',
  'TooManyProviderTokenUpdates',
]);

/**
 * Classifies one APNs response from its HTTP status **and** its `reason`
 * field — the status alone is not enough (400 covers both "this token is
 * dead" and "your payload/topic is wrong", and 403 covers transient expired
 * provider tokens as well as misconfiguration).
 */
export function classifyApnsResponse(status: number, reason: string): ApnsReasonClass {
  if (status >= 200 && status < 300) {
    return 'accepted';
  }
  const normalized = reason?.trim();
  if (normalized) {
    if (APNS_INVALID_TOKEN_REASONS.has(normalized)) {
      return 'invalid-token';
    }
    if (APNS_PERMANENT_MESSAGE_REASONS.has(normalized)) {
      return 'permanent';
    }
    if (APNS_MISCONFIGURATION_REASONS.has(normalized)) {
      return 'misconfigured';
    }
    if (APNS_RETRYABLE_REASONS.has(normalized)) {
      return 'retryable';
    }
  }
  if (status === 410) {
    return 'invalid-token';
  }
  if (status === 404) {
    // APNs answers 404 for a malformed device-token path.
    return 'invalid-token';
  }
  if (status === 400) {
    // Unknown 400 without a recognised reason: the safest reading is a
    // message/payload problem — never retire the token on a bare 400.
    return 'permanent';
  }
  if (status === 401 || status === 403) {
    return 'misconfigured';
  }
  if (status === 429 || status >= 500) {
    return 'retryable';
  }
  return 'retryable';
}

/**
 * Direct Apple Push Notification service provider — iOS rail (free).
 *
 * There is **no purchasing or vendor in between**: this sends straight to
 * APNs over HTTP/2 using the ES256 provider-token flow, built on Node's
 * `node:http2` and `node:crypto` modules (no new dependency).
 *
 * Prerequisites, stated precisely because "free" is often over-promised:
 * APNs **delivery** is free — Apple charges nothing per notification and no
 * paid push vendor is used here. What is *not* free is bypassing Apple
 * signing: the app must be signed with a bundle id whose App ID enables the
 * Push Notifications capability, and the auth key (`.p8`) + Key ID + Team ID
 * must belong to the Apple Developer account that owns that bundle id.
 * Installing on a physical iPhone requires Apple code signing (a free Apple
 * ID "personal team" can sign, but with Apple's own 7-day/3-app limits and no
 * App Store distribution); the APNs key itself is issued from the developer
 * account. Nothing here bypasses code signing, and no purchase is required
 * for delivery — this code only ever talks to APNs with credentials the
 * operator already has.
 *
 * It targets **one APNs device token per request** (APNs has no multicast),
 * so `send` loops the batch, aggregates per-device outcomes and guarantees
 * that every attempted token ends up in exactly one outcome bucket — even
 * when a request times out, the connection breaks or a later token in the
 * batch is never reached.
 */
export class ApnsDirectProvider implements PushNotificationProvider {
  readonly name = 'apns-direct';
  readonly isConfigured = true;

  private readonly logger = new Logger(ApnsDirectProvider.name);
  private readonly requestTimeoutMs: number;
  private token: string | null = null;
  /** Epoch **milliseconds** at which the cached provider token is refreshed. */
  private tokenExpiresAtMs = 0;

  constructor(
    private readonly options: ApnsDirectOptions,
    private readonly requestFn: ApnsRequestFn = defaultApnsRequest,
    /** Injectable clock (ms) — keeps JWT caching testable without waiting. */
    private readonly now: () => number = () => Date.now(),
  ) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_APNS_TIMEOUT_MS;
  }

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

    const outcome: DeviceDeliveryOutcome = { ...emptyDeviceOutcome(), notConfigured };
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

    // The deadline is evaluated here, immediately before the network calls,
    // and re-evaluated per token below so a long batch cannot ship a message
    // whose window closed while earlier tokens were being sent.
    if (isExpired(payload.expiresAt, this.now())) {
      outcome.expired.push(...apnsTokens);
      return this.composeResult(
        outcome,
        apnsTokens,
        'Notification deadline passed before the APNs send',
      );
    }

    for (const token of apnsTokens) {
      if (isExpired(payload.expiresAt, this.now())) {
        outcome.expired.push(token);
        continue;
      }
      try {
        const result = await this.sendToOne(token, payload);
        if (result.class === 'accepted') {
          outcome.delivered.push(token);
        } else if (result.class === 'invalid-token') {
          outcome.invalid.push(token);
        } else if (result.class === 'misconfigured') {
          outcome.misconfigured.push(token);
          outcome.misconfiguredReason = outcome.misconfiguredReason ?? result.reason ?? null;
        } else if (result.class === 'permanent') {
          outcome.permanent.push(token);
          outcome.permanentReason = outcome.permanentReason ?? result.reason ?? null;
        } else {
          outcome.retryable.push(token);
        }
      } catch (error) {
        // A thrown error (timeout, connection failure, socket error) is a
        // retryable failure for *this* token; the loop continues so every
        // remaining token still gets a defined outcome instead of vanishing.
        this.logger.warn(
          `APNs send failed for ${first8(token)}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        outcome.retryable.push(token);
      }
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

  private composeResult(
    outcome: DeviceDeliveryOutcome,
    apnsTokens: string[],
    errorOverride?: string,
  ): PushDeliveryResult {
    const common = {
      provider: this.name,
      messageId: `apns-${this.now()}`,
      ...(outcome.invalid.length > 0 ? { invalidTokens: outcome.invalid } : {}),
      deviceOutcome: outcome,
    };

    if (outcome.retryable.length > 0) {
      // Even with accepted tokens, the row is reported retryable so the
      // outbox keeps the *undelivered* devices in its pending set.
      return {
        ...common,
        success: outcome.delivered.length > 0,
        error: errorOverride ?? 'APNs delivery incomplete (transient failures remain)',
        retryable: true,
        delivery: { retryable: true, permanent: false },
      };
    }

    if (outcome.delivered.length > 0) {
      return { ...common, success: true, retryable: false };
    }

    const terminalReason =
      errorOverride ??
      outcome.misconfiguredReason ??
      outcome.permanentReason ??
      'All APNs device tokens were rejected (unregistered, invalid or expired)';

    return {
      ...common,
      success: false,
      error: terminalReason,
      retryable: false,
      delivery: { retryable: false, permanent: true },
    };
  }

  /** One APNs request (HTTP/2) for one device token. */
  private async sendToOne(
    deviceToken: string,
    payload: PushNotificationPayload,
  ): Promise<{ class: ApnsReasonClass; reason?: string }> {
    const bearer = await this.providerToken();
    const path = `/3/device/${encodeURIComponent(deviceToken)}`;
    const expirationSeconds = apnsExpiration(payload.expiresAt);
    const headers: Record<string, string> = {
      ':method': 'POST',
      ':path': path,
      authorization: `bearer ${bearer}`,
      'apns-topic': this.options.topic,
      'apns-push-type': 'alert',
      'apns-priority': payload.priority === 'high' ? '10' : '5',
      // Absolute Unix-seconds deadline: APNs stores the notification only
      // until this instant. It cannot un-display an alert the phone already
      // showed, and it does not make delivery instant — it only stops a
      // stale alert from being delivered later than the event window.
      ...(expirationSeconds !== null ? { 'apns-expiration': String(expirationSeconds) } : {}),
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

    const response = await this.requestFn(
      `https://${apnsHost(this.options.production)}${path}`,
      headers,
      body,
      this.requestTimeoutMs,
    );

    const classification = classifyApnsResponse(response.status, response.reason);
    if (classification === 'invalid-token') {
      this.logger.warn(
        `APNs retired an unregistered device token (${response.status} ${response.reason}): ${first8(deviceToken)}`,
      );
    } else if (classification === 'misconfigured') {
      this.logger.error(
        `APNs rejected the request for a configuration reason (${response.status} ${response.reason}) — device tokens are kept; check APNS_KEY_ID/APNS_KEY_PEM/APNS_TOPIC/APNS_PRODUCTION.`,
      );
    } else if (classification === 'permanent') {
      this.logger.warn(
        `APNs rejected the message payload (${response.status} ${response.reason}) — device token kept.`,
      );
    }
    if (APNS_PROVIDER_TOKEN_REFRESH_REASONS.has(response.reason?.trim() ?? '')) {
      // Force a fresh provider token on the next attempt/token.
      this.invalidateProviderToken();
    }
    return { class: classification, reason: response.reason };
  }

  /** Drops the cached ES256 provider token (used after a 403 from APNs). */
  invalidateProviderToken(): void {
    this.token = null;
    this.tokenExpiresAtMs = 0;
  }

  /**
   * ES256 provider token (a standards-compliant JWT), cached until
   * {@link APNS_TOKEN_TTL_MS} after issue. All time arithmetic here is in
   * **milliseconds** — the JWT `iat` claim is the only seconds value, and the
   * cache compares the same millisecond clock it was written with.
   *
   * Apple requires the signature to be IEEE-P1363 `R || S` (64 bytes for
   * P-256), base64url-encoded without padding — Node's default ECDSA output
   * is DER, which APNs rejects (`InvalidProviderToken`).
   */
  private async providerToken(): Promise<string> {
    const nowMs = this.now();
    if (this.token && nowMs < this.tokenExpiresAtMs) {
      return this.token;
    }
    const issuedAtSeconds = Math.floor(nowMs / 1000);
    const header = base64Url(json({ alg: 'ES256', kid: this.options.keyId }));
    const claims = base64Url(json({ iss: this.options.teamId, iat: issuedAtSeconds }));
    const signingInput = `${header}.${claims}`;
    const signature = await signEcdsa(this.options.keyPem, signingInput);
    this.token = `${signingInput}.${signature}`;
    this.tokenExpiresAtMs = nowMs + APNS_TOKEN_TTL_MS;
    return this.token;
  }
}

/** Constructs the real APNs HTTP/2 request (production path). */
export function defaultApnsRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number = DEFAULT_APNS_TIMEOUT_MS,
): Promise<{ status: number; reason: string; error?: string }> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    let settled = false;
    let session: ClientHttp2Session | null = null;
    let deadline: ReturnType<typeof setTimeout> | null = null;

    /** Settles exactly once and always releases the HTTP/2 session. */
    const finish = (
      outcome:
        | { kind: 'response'; value: { status: number; reason: string } }
        | { kind: 'error'; value: Error },
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (deadline) {
        clearTimeout(deadline);
        deadline = null;
      }
      try {
        // Destroy the session *without* removing its listeners: a teardown
        // error (e.g. ECONNREFUSED racing a timeout) would otherwise be
        // emitted with no handler and crash the process. The `settled` guard
        // keeps every late event a no-op.
        session?.destroy();
      } catch {
        // Destroying an already-closed session is not an error.
      }
      session = null;
      if (outcome.kind === 'response') {
        resolve(outcome.value);
      } else {
        reject(outcome.value);
      }
    };

    try {
      session = connect(target);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    const activeSession = session;
    // A session/request that never produces a response (or a connection that
    // stalls) must still settle the promise and release the socket, otherwise
    // the outbox row would hang forever with no defined outcome.
    deadline = setTimeout(() => {
      finish({ kind: 'error', value: new Error(`APNs request timed out after ${timeoutMs}ms`) });
    }, timeoutMs);
    if (typeof deadline.unref === 'function') {
      deadline.unref();
    }
    activeSession.setTimeout(timeoutMs, () => {
      finish({ kind: 'error', value: new Error(`APNs session timed out after ${timeoutMs}ms`) });
    });

    let req: ReturnType<ClientHttp2Session['request']>;
    try {
      req = activeSession.request(
        {
          ':method': 'POST',
          ':path': headers[':path'] ?? '/',
          ...apnsHeaders(headers),
        },
        { waitForTrailers: false },
      );
    } catch (error) {
      finish({ kind: 'error', value: error instanceof Error ? error : new Error(String(error)) });
      return;
    }

    const chunks: Buffer[] = [];
    let status: number | undefined;
    req.on('response', (responseHeaders: IncomingHttpHeaders) => {
      status = statusFromHeaders(responseHeaders);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => {
      finish({ kind: 'response', value: { status: status ?? 0, reason: tryParseReason(chunks) } });
    });
    req.on('error', (error) => {
      finish({ kind: 'error', value: error });
    });
    activeSession.on('error', (error) => {
      finish({
        kind: 'error',
        value: error instanceof Error ? error : new Error(String(error)),
      });
    });
    activeSession.on('goaway', () => {
      finish({ kind: 'error', value: new Error('APNs connection closed (GOAWAY)') });
    });
    try {
      req.end(body);
    } catch (error) {
      finish({ kind: 'error', value: error instanceof Error ? error : new Error(String(error)) });
    }
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
  if (typeof raw === 'number') {
    return raw;
  }
  if (typeof raw === 'string') {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * `apns-expiration` in Unix **seconds** (the unit APNs documents), or `null`
 * when the payload carries no deadline.
 */
export function apnsExpiration(expiresAt: Date | null | undefined): number | null {
  if (!expiresAt) {
    return null;
  }
  const deadline = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  return Number.isFinite(deadline) ? Math.floor(deadline / 1000) : null;
}

function isExpired(expiresAt: Date | null | undefined, nowMs: number): boolean {
  const seconds = apnsExpiration(expiresAt);
  return seconds !== null && seconds * 1000 <= nowMs;
}

/**
 * Signs `input` with the APNs `.p8` P-256 private key (ES256).
 *
 * Uses IEEE-P1363 (`R || S`) encoding as JWT/ES256 requires — 64 decoded
 * bytes for P-256. Node's default for ECDSA is DER, which APNs rejects.
 */
export async function signEcdsa(pem: string, input: string): Promise<string> {
  const { createSign } = await import('node:crypto');
  const signer = createSign('SHA256');
  signer.update(input);
  signer.end();
  const signature = signer.sign({ key: pem, dsaEncoding: 'ieee-p1363' });
  if (signature.length !== 64) {
    // P-256 IEEE-P1363 is always 64 bytes; anything else is not a valid ES256
    // JWT signature and APNs would answer InvalidProviderToken.
    throw new Error(
      `ES256 signature had ${signature.length} bytes (expected 64) — check that APNS_KEY_PEM is a P-256 (prime256v1) key.`,
    );
  }
  return signature.toString('base64url');
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
