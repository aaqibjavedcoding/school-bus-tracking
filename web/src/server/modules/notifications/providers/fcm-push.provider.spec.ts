import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { PushNotificationPayload } from './notification-provider.interface';
import { FcmPushProvider, FCM_MAX_TTL_MS, isInvalidTokenError } from './fcm-push.provider';

/**
 * FCM provider behaviour against a mocked `firebase-admin` messaging surface
 * (the real SDK is only touched in production; the provider accepts an
 * injected `sendEachForMulticast` so every path is testable without
 * credentials).
 */
const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'demo-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  client_email: 'push@demo-project.iam.gserviceaccount.com',
};

const payload: PushNotificationPayload = {
  recipientId: 'user-1',
  title: 'Aarav boarded',
  body: 'Aarav Sharma boarded the school bus.',
  data: { school_id: 's1', user_id: 'user-1', type: 'STUDENT_BOARDED', id: 'n1' },
  deviceTokens: ['tok-a', 'tok-b'],
  priority: 'high',
};

interface FakeResponse {
  success: boolean;
  error?: { code?: string; errorInfo?: { code?: string; message?: string } };
}

function fakeMessaging(responses: FakeResponse[]) {
  let lastMessage: unknown = null;
  return {
    async sendEachForMulticast(message: unknown) {
      lastMessage = message;
      return {
        successCount: responses.filter((r) => r.success).length,
        failureCount: responses.filter((r) => !r.success).length,
        responses,
      };
    },
    lastMessage: () => lastMessage,
  };
}

function provider(responses: FakeResponse[]): {
  provider: FcmPushProvider;
  received: () => Record<string, unknown>;
} {
  const messaging = fakeMessaging(responses);
  const provider = new FcmPushProvider(
    SERVICE_ACCOUNT,
    'demo-project',
    messaging as unknown as never,
  );
  return {
    provider,
    received: () => messaging.lastMessage() as Record<string, unknown>,
  };
}

describe('FcmPushProvider.send', () => {
  it('sends a notification message (title/body) + string data via multicast', async () => {
    const { provider: push, received } = provider([{ success: true }, { success: true }]);

    const result = await push.send(payload);

    assert.equal(result.success, true);
    assert.equal(result.provider, 'fcm');
    assert.ok(result.messageId?.startsWith('fcm-'));
    assert.equal(result.invalidTokens, undefined);

    const message = received() as {
      tokens: string[];
      notification: { title: string; body: string };
      data: Record<string, string>;
      android: { priority: string; notification: { channelId: string } };
      apns: { payload: { aps: { sound: string } } };
    };
    assert.deepEqual(message.tokens, ['tok-a', 'tok-b']);
    assert.deepEqual(message.notification, {
      title: 'Aarav boarded',
      body: 'Aarav Sharma boarded the school bus.',
    });
    assert.equal(message.data.school_id, 's1');
    assert.equal(message.data.type, 'STUDENT_BOARDED');
    assert.equal(message.android.priority, 'high');
    assert.equal(message.android.notification.channelId, 'notifications');
    assert.equal(message.apns.payload.aps.sound, 'default');
  });

  it('reports invalid tokens from a partially failed multicast while still succeeding', async () => {
    const { provider: push } = provider([
      { success: true },
      {
        success: false,
        error: { errorInfo: { code: 'messaging/registration-token-not-registered' } },
      },
    ]);

    const result = await push.send(payload);

    assert.equal(result.success, true);
    assert.deepEqual(result.invalidTokens, ['tok-b']);
  });

  it('returns a permanent failure with invalidTokens when every token is unregistered', async () => {
    const { provider: push } = provider([
      { success: false, error: { code: 'UNREGISTERED' } },
      { success: false, error: { errorInfo: { code: 'messaging/invalid-registration-token' } } },
    ]);

    const result = await push.send(payload);

    assert.equal(result.success, false);
    // All-invalid is permanent (invalid tokens are retired, never retried).
    assert.equal(result.retryable, false);
    assert.equal(result.delivery?.permanent, true);
    assert.deepEqual(result.invalidTokens?.sort(), ['tok-a', 'tok-b']);
    assert.ok(result.error);
  });

  it('returns a retryable failure for a non-invalid provider error', async () => {
    const { provider: push } = provider([
      {
        success: false,
        error: { errorInfo: { code: 'messaging/third-party-auth-error', message: 'Auth failed' } },
      },
    ]);

    const result = await push.send(payload);

    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.error, 'Auth failed');
    assert.equal(result.invalidTokens, undefined);
  });

  it('swallows a thrown SDK error into a retryable failure', async () => {
    const messaging = {
      sendEachForMulticast: async () => {
        throw new Error('network unreachable');
      },
    };
    const push = new FcmPushProvider(SERVICE_ACCOUNT, 'demo-project', messaging as never);

    const result = await push.send(payload);

    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.equal(result.error, 'network unreachable');
  });

  it('never calls the provider without tokens', async () => {
    let called = false;
    const push = new FcmPushProvider(SERVICE_ACCOUNT, 'demo-project', {
      sendEachForMulticast: async () => ((called = true), { responses: [] }),
    } as never);

    const result = await push.send({ ...payload, deviceTokens: [] });

    assert.equal(called, false);
    assert.equal(result.success, false);
    assert.equal(result.error, 'No device tokens');
  });
});

describe('isInvalidTokenError', () => {
  it('matches both the legacy wire codes and the Admin SDK codes', () => {
    assert.equal(isInvalidTokenError({ code: 'UNREGISTERED' }), true);
    assert.equal(isInvalidTokenError({ code: 'INVALID_REGISTRATION' }), true);
    assert.equal(
      isInvalidTokenError({ errorInfo: { code: 'messaging/registration-token-not-registered' } }),
      true,
    );
    assert.equal(
      isInvalidTokenError({ errorInfo: { code: 'messaging/invalid-registration-token' } }),
      true,
    );
  });

  it('ignores transient errors that should be retried, not deactivated', () => {
    assert.equal(
      isInvalidTokenError({ errorInfo: { code: 'messaging/third-party-auth-error' } }),
      false,
    );
    assert.equal(isInvalidTokenError({ code: 'messaging/quota-exceeded' }), false);
    assert.equal(isInvalidTokenError(null), false);
    assert.equal(isInvalidTokenError(undefined), false);
  });
});

describe('FcmPushProvider — TTL / deadline propagation (fix C)', () => {
  it('passes the remaining lifetime as android.ttl in the SDK’s millisecond unit', async () => {
    const { provider: push, received } = provider([{ success: true }, { success: true }]);
    const expiresAt = new Date(Date.now() + 120_000);

    await push.send({ ...payload, expiresAt });

    const message = received() as { android?: { ttl?: number } };
    assert.equal(typeof message.android?.ttl, 'number');
    assert.ok(
      message.android!.ttl! > 100_000 && message.android!.ttl! <= 120_000,
      `ttl is the remaining lifetime in ms, got ${message.android!.ttl}`,
    );
  });

  it('clamps the TTL to FCM’s documented 4-week maximum', async () => {
    const { provider: push, received } = provider([{ success: true }, { success: true }]);
    const expiresAt = new Date(Date.now() + 10 * 7 * 24 * 60 * 60 * 1000);

    await push.send({ ...payload, expiresAt });

    const message = received() as { android?: { ttl?: number } };
    assert.equal(message.android?.ttl, FCM_MAX_TTL_MS);
    assert.equal(FCM_MAX_TTL_MS, 2_419_200_000);
  });

  it('omits ttl entirely when the notification has no deadline', async () => {
    const { provider: push, received } = provider([{ success: true }, { success: true }]);

    await push.send(payload);

    const message = received() as { android?: { ttl?: number } };
    assert.equal(message.android?.ttl, undefined, 'no deadline → FCM default TTL');
  });

  it('never calls FCM for an already-expired notification and reports the devices as expired', async () => {
    const { provider: push, received } = provider([]);

    const result = await push.send({ ...payload, expiresAt: new Date(Date.now() - 5_000) });

    assert.equal(received(), null, 'no provider call for an expired message');
    assert.deepEqual(result.deviceOutcome?.expired, ['tok-a', 'tok-b']);
    assert.equal(result.success, false);
    assert.equal(result.retryable, false);
  });

  it('classifies credential errors as a configuration failure without retiring tokens', async () => {
    const messaging = {
      async sendEachForMulticast() {
        throw Object.assign(new Error('invalid credential'), { code: 'app/invalid-credential' });
      },
    };
    const push = new FcmPushProvider(
      SERVICE_ACCOUNT,
      'demo-project',
      messaging as unknown as never,
    );

    const result = await push.send(payload);

    assert.deepEqual(result.deviceOutcome?.misconfigured, ['tok-a', 'tok-b']);
    assert.deepEqual(result.deviceOutcome?.invalid, [], 'tokens are kept');
    assert.equal(result.deviceOutcome?.misconfiguredReason, 'invalid credential');
    assert.equal(result.retryable, false);
  });

  it('classifies payload errors as a permanent message failure without retiring tokens', async () => {
    const messaging = {
      async sendEachForMulticast() {
        throw Object.assign(new Error('invalid payload'), { code: 'messaging/invalid-payload' });
      },
    };
    const push = new FcmPushProvider(
      SERVICE_ACCOUNT,
      'demo-project',
      messaging as unknown as never,
    );

    const result = await push.send(payload);

    assert.deepEqual(result.deviceOutcome?.permanent, ['tok-a', 'tok-b']);
    assert.deepEqual(result.deviceOutcome?.invalid, []);
    assert.equal(result.retryable, false);
  });

  it('keeps unknown provider errors retryable', async () => {
    const messaging = {
      async sendEachForMulticast() {
        throw new Error('network hiccup');
      },
    };
    const push = new FcmPushProvider(
      SERVICE_ACCOUNT,
      'demo-project',
      messaging as unknown as never,
    );

    const result = await push.send(payload);

    assert.deepEqual(result.deviceOutcome?.retryable, ['tok-a', 'tok-b']);
    assert.equal(result.retryable, true);
  });
});
