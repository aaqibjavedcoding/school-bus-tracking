import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateKeyPairSync, verify as cryptoVerify, type KeyObject } from 'node:crypto';
import { createServer } from 'node:http2';
import type { AddressInfo } from 'node:net';
import type { PushNotificationPayload } from './notification-provider.interface';
import {
  ApnsDirectProvider,
  APNS_PRODUCTION_HOST,
  APNS_SANDBOX_HOST,
  APNS_TOKEN_TTL_MS,
  apnsExpiration,
  classifyApnsResponse,
  defaultApnsRequest,
  type ApnsRequestFn,
} from './apns-direct.provider';

/** A real ES256 P-256 key pair — the provider token is signed and verified. */
function realApnsKeys(): { privatePem: string; publicKey: KeyObject } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey,
  };
}

const KEYS = realApnsKeys();

const OPTIONS = {
  keyPem: KEYS.privatePem,
  keyId: 'ABC1234567',
  teamId: 'TEAM123456',
  topic: 'com.schoolbustracking.app',
  production: true,
};

interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
}

function requestFn(
  handler: (request: RecordedRequest, index: number) => Promise<{ status: number; reason: string }>,
): {
  fn: ApnsRequestFn;
  records: RecordedRequest[];
} {
  const records: RecordedRequest[] = [];
  const fn: ApnsRequestFn = async (url, headers, body, timeoutMs) => {
    const request = { url, headers, body, timeoutMs };
    records.push(request);
    return handler(request, records.length - 1);
  };
  return { fn, records };
}

const payload: PushNotificationPayload = {
  recipientId: 'u1',
  title: 'Stop arrived',
  body: 'Green Park Stop',
  data: { trip_id: 't1', type: 'STOP_ARRIVED' },
  deviceTokens: ['ios-1'],
  priority: 'high',
};

function decodeJwt(jwt: string): {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signature: Buffer;
  signingInput: string;
} {
  const [encodedHeader, encodedClaims, encodedSignature] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8')),
    claims: JSON.parse(Buffer.from(encodedClaims, 'base64url').toString('utf8')),
    signature: Buffer.from(encodedSignature, 'base64url'),
    signingInput: `${encodedHeader}.${encodedClaims}`,
  };
}

describe('ApnsDirectProvider — host selection (fix B1)', () => {
  it('uses the production host when the provider is configured for production, whatever NODE_ENV says', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    try {
      const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));
      await new ApnsDirectProvider({ ...OPTIONS, production: true }, fn).send(payload);
      assert.match(records[0].url, new RegExp(`^https://${APNS_PRODUCTION_HOST}/`));
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('uses the sandbox host when the provider is configured for sandbox, whatever NODE_ENV says', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));
      await new ApnsDirectProvider({ ...OPTIONS, production: false }, fn).send(payload);
      assert.match(records[0].url, new RegExp(`^https://${APNS_SANDBOX_HOST}/`));
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('ApnsDirectProvider — ES256 provider token (fix B2)', () => {
  it('signs a standards-compliant JWT: alg/kid header, iss/iat claims, IEEE-P1363 64-byte signature', async () => {
    const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    await provider.send(payload);

    const authorization = records[0].headers['authorization'];
    assert.match(authorization, /^bearer /);
    const jwt = authorization.slice('bearer '.length);
    const { header, claims, signature, signingInput } = decodeJwt(jwt);

    assert.equal(header['alg'], 'ES256');
    assert.equal(header['kid'], 'ABC1234567');
    assert.equal(claims['iss'], 'TEAM123456');
    assert.equal(typeof claims['iat'], 'number');

    // The JWT must carry the raw R||S representation (64 bytes for P-256),
    // not Node's default DER encoding.
    assert.equal(signature.length, 64, 'IEEE-P1363 signature is exactly 64 bytes');
    assert.equal(
      cryptoVerify(
        'sha256',
        Buffer.from(signingInput),
        { key: KEYS.publicKey, dsaEncoding: 'ieee-p1363' },
        signature,
      ),
      true,
      'the signature verifies as IEEE-P1363 ES256',
    );
    assert.equal(
      cryptoVerify(
        'sha256',
        Buffer.from(signingInput),
        { key: KEYS.publicKey, dsaEncoding: 'der' },
        signature,
      ),
      false,
      'the signature is not DER (the bug this patch fixes)',
    );
  });

  it('caches the provider token and refreshes it after the TTL (injected clock)', async () => {
    let nowMs = Date.UTC(2026, 8, 18, 10, 0, 0);
    const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn, () => nowMs);

    await provider.send({ ...payload, deviceTokens: ['ios-1'] });
    nowMs += APNS_TOKEN_TTL_MS - 1_000; // still inside the cache window
    await provider.send({ ...payload, deviceTokens: ['ios-2'] });
    nowMs += 2_000; // past the window
    await provider.send({ ...payload, deviceTokens: ['ios-3'] });

    const first = records[0].headers['authorization'].slice('bearer '.length);
    const second = records[1].headers['authorization'].slice('bearer '.length);
    const third = records[2].headers['authorization'].slice('bearer '.length);

    assert.equal(first, second, 'cached within the TTL');
    assert.notEqual(second, third, 'refreshed after the TTL');
    assert.ok(
      Number(decodeJwt(third).claims['iat']) > Number(decodeJwt(second).claims['iat']),
      'the refreshed token carries a later iat',
    );
  });

  it('refreshes the cached token after an ExpiredProviderToken 403 and retries as retryable', async () => {
    let calls = 0;
    const { fn, records } = requestFn(async () => {
      calls += 1;
      return calls === 1
        ? { status: 403, reason: 'ExpiredProviderToken' }
        : { status: 200, reason: '' };
    });
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    const first = await provider.send({ ...payload, deviceTokens: ['ios-1'] });
    assert.deepEqual(first.deviceOutcome?.retryable, ['ios-1']);
    assert.equal(first.retryable, true);
    assert.equal(
      first.invalidTokens,
      undefined,
      'an expired provider token is not a device problem',
    );

    await provider.send({ ...payload, deviceTokens: ['ios-2'] });
    assert.notEqual(
      records[0].headers['authorization'],
      records[1].headers['authorization'],
      'a fresh provider token is used after the 403',
    );
  });
});

describe('ApnsDirectProvider — APNs reason handling (fix B3)', () => {
  it('retires a genuinely unregistered token (410 Unregistered)', async () => {
    const { fn } = requestFn(async () => ({ status: 410, reason: 'Unregistered' }));
    const result = await new ApnsDirectProvider(OPTIONS, fn).send(payload);

    assert.deepEqual(result.invalidTokens, ['ios-1']);
    assert.deepEqual(result.deviceOutcome?.invalid, ['ios-1']);
    assert.equal(result.retryable, false);
    assert.equal(result.delivery?.permanent, true);
  });

  it('retires a bad device token (400 BadDeviceToken)', async () => {
    const { fn } = requestFn(async () => ({ status: 400, reason: 'BadDeviceToken' }));
    const result = await new ApnsDirectProvider(OPTIONS, fn).send(payload);

    assert.deepEqual(result.invalidTokens, ['ios-1']);
    assert.equal(result.retryable, false);
  });

  it('does not retire the token for a payload error (400 PayloadTooLarge / BadPriority)', async () => {
    for (const reason of ['PayloadTooLarge', 'BadPriority', 'PayloadEmpty']) {
      const { fn } = requestFn(async () => ({ status: 400, reason }));
      const result = await new ApnsDirectProvider(OPTIONS, fn).send(payload);

      assert.equal(result.invalidTokens, undefined, `${reason} must not deactivate the token`);
      assert.deepEqual(
        result.deviceOutcome?.permanent,
        ['ios-1'],
        `${reason} is a permanent message error`,
      );
      assert.deepEqual(result.deviceOutcome?.invalid, []);
      assert.equal(result.retryable, false);
      assert.equal(result.deviceOutcome?.permanentReason, reason);
    }
  });

  it('does not retire the token for bad provider credentials (403 InvalidProviderToken)', async () => {
    const { fn } = requestFn(async () => ({ status: 403, reason: 'InvalidProviderToken' }));
    const result = await new ApnsDirectProvider(OPTIONS, fn).send(payload);

    assert.equal(result.invalidTokens, undefined);
    assert.deepEqual(result.deviceOutcome?.misconfigured, ['ios-1']);
    assert.equal(result.deviceOutcome?.misconfiguredReason, 'InvalidProviderToken');
    assert.equal(result.retryable, false, 'configuration failures are terminal, not retried');
  });

  it('does not retire the token for an incorrect topic (400 BadTopic / DeviceTokenNotForTopic)', async () => {
    for (const reason of ['BadTopic', 'DeviceTokenNotForTopic', 'TopicDisallowed']) {
      const { fn } = requestFn(async () => ({ status: 400, reason }));
      const result = await new ApnsDirectProvider(OPTIONS, fn).send(payload);

      assert.equal(result.invalidTokens, undefined, `${reason} must not wipe the device registry`);
      assert.deepEqual(result.deviceOutcome?.misconfigured, ['ios-1']);
      assert.deepEqual(result.deviceOutcome?.invalid, []);
    }
  });

  it('classifies bare 400/401/403/404 without a reason safely', () => {
    assert.equal(classifyApnsResponse(400, ''), 'permanent');
    assert.equal(classifyApnsResponse(401, ''), 'misconfigured');
    assert.equal(classifyApnsResponse(403, ''), 'misconfigured');
    assert.equal(classifyApnsResponse(404, ''), 'invalid-token');
    assert.equal(classifyApnsResponse(200, ''), 'accepted');
  });

  it('treats 429 and 5xx as retryable', async () => {
    for (const [status, reason] of [
      [429, 'TooManyRequests'],
      [500, 'InternalServerError'],
      [503, 'ServiceUnavailable'],
      [503, 'Shutdown'],
    ] as const) {
      const { fn } = requestFn(async () => ({ status, reason }));
      const result = await new ApnsDirectProvider(OPTIONS, fn).send(payload);
      assert.equal(result.retryable, true, `${status} ${reason}`);
      assert.deepEqual(result.deviceOutcome?.retryable, ['ios-1']);
      assert.equal(result.invalidTokens, undefined);
    }
  });

  it('reports realistic mixed per-device outcomes in one batch', async () => {
    const responses: Array<{ status: number; reason: string }> = [
      { status: 200, reason: '' },
      { status: 410, reason: 'Unregistered' },
      { status: 503, reason: 'ServiceUnavailable' },
      { status: 400, reason: 'PayloadTooLarge' },
    ];
    let index = 0;
    const { fn } = requestFn(async () => responses[index++]);
    const result = await new ApnsDirectProvider(OPTIONS, fn).send({
      ...payload,
      deviceTokens: ['ok', 'stale', 'busy', 'huge'],
    });

    assert.deepEqual(result.deviceOutcome?.delivered, ['ok']);
    assert.deepEqual(result.deviceOutcome?.invalid, ['stale']);
    assert.deepEqual(result.deviceOutcome?.retryable, ['busy']);
    assert.deepEqual(result.deviceOutcome?.permanent, ['huge']);
    assert.equal(result.success, true, 'the accepted device keeps the row alive');
    assert.equal(result.retryable, true, 'the busy device is still owed a delivery');
    assert.deepEqual(result.invalidTokens, ['stale']);
  });

  it('refuses to send Android tokens through APNs (never as an FCM token)', async () => {
    let called = false;
    const { fn } = requestFn(async () => ((called = true), { status: 200, reason: '' }));
    const result = await new ApnsDirectProvider(OPTIONS, fn).send({
      ...payload,
      deviceTokens: ['android-reg'],
      tokenPlatforms: ['android'],
    });

    assert.equal(called, false);
    assert.deepEqual(result.deviceOutcome?.notConfigured, ['android-reg']);
    assert.equal(result.success, false);
    assert.equal(result.delivery?.permanent, true);
  });
});

describe('ApnsDirectProvider — deadline propagation (fix C)', () => {
  it('sets apns-expiration to the notification deadline in Unix seconds', async () => {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000 + 500);
    const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));

    await new ApnsDirectProvider(OPTIONS, fn).send({ ...payload, expiresAt });

    assert.equal(
      records[0].headers['apns-expiration'],
      String(Math.floor(expiresAt.getTime() / 1000)),
    );
    assert.equal(apnsExpiration(expiresAt), Math.floor(expiresAt.getTime() / 1000));
  });

  it('never sends an already-expired notification and reports the tokens as expired', async () => {
    const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));
    const result = await new ApnsDirectProvider(OPTIONS, fn).send({
      ...payload,
      expiresAt: new Date(Date.now() - 1_000),
    });

    assert.equal(records.length, 0, 'no provider call for an expired message');
    assert.deepEqual(result.deviceOutcome?.expired, ['ios-1']);
    assert.equal(result.success, false);
    assert.equal(result.retryable, false);
  });

  it('re-checks the deadline per token so a batch that outlives the window stops sending', async () => {
    let nowMs = Date.now();
    const expiresAt = new Date(nowMs + 5_000);
    const { fn, records } = requestFn(async () => {
      nowMs += 10_000; // the first send consumes the remaining window
      return { status: 200, reason: '' };
    });
    const result = await new ApnsDirectProvider(OPTIONS, fn, () => nowMs).send({
      ...payload,
      deviceTokens: ['ios-1', 'ios-2'],
      expiresAt,
    });

    assert.equal(records.length, 1, 'the second token is never sent');
    assert.deepEqual(result.deviceOutcome?.delivered, ['ios-1']);
    assert.deepEqual(result.deviceOutcome?.expired, ['ios-2']);
  });
});

describe('ApnsDirectProvider — network/session failures settle cleanly (fix B4)', () => {
  it('marks the token retryable and keeps going when a token request throws', async () => {
    const { fn } = requestFn(async (_request, index) => {
      if (index === 0) {
        throw new Error('ECONNRESET');
      }
      return { status: 200, reason: '' };
    });
    const result = await new ApnsDirectProvider(OPTIONS, fn).send({
      ...payload,
      deviceTokens: ['ios-1', 'ios-2'],
    });

    assert.deepEqual(result.deviceOutcome?.retryable, ['ios-1']);
    assert.deepEqual(result.deviceOutcome?.delivered, ['ios-2']);
    assert.equal(result.retryable, true);
  });

  it('settles the HTTP/2 request and closes the session when the server never responds', async () => {
    const server = createServer();
    const sessions = new Set<unknown>();
    let closed = 0;
    server.on('session', (session: { on(event: string, listener: () => void): void }) => {
      sessions.add(session);
      session.on('close', () => {
        closed += 1;
      });
    });
    // The stream is accepted and deliberately never answered.
    server.on('stream', () => undefined);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      await assert.rejects(
        () =>
          defaultApnsRequest(
            `http://127.0.0.1:${port}/3/device/ios-1`,
            { ':method': 'POST', ':path': '/3/device/ios-1', 'apns-topic': OPTIONS.topic },
            '{}',
            250,
          ),
        /timed out/i,
      );
      // Give the destroy a tick to propagate.
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(closed >= 1, 'the HTTP/2 session is closed, not leaked');
    } finally {
      server.close();
    }
  });

  it('settles with an error when the connection is refused', async () => {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    await new Promise<void>((resolve) => server.close(() => resolve()));

    await assert.rejects(
      () =>
        defaultApnsRequest(
          `http://127.0.0.1:${port}/3/device/ios-1`,
          { ':method': 'POST', ':path': '/3/device/ios-1' },
          '{}',
          1_000,
        ),
      /ECONNREFUSED|connect|socket/i,
    );
  });

  it('leaves every target with a defined outcome when the provider itself fails', async () => {
    const throwing: ApnsRequestFn = async () => {
      throw new Error('socket hang up');
    };
    const result = await new ApnsDirectProvider(OPTIONS, throwing).send({
      ...payload,
      deviceTokens: ['ios-1', 'ios-2', 'ios-3'],
    });

    assert.deepEqual(result.deviceOutcome?.retryable, ['ios-1', 'ios-2', 'ios-3']);
    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
  });
});
