import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type { PushNotificationPayload } from './notification-provider.interface';
import { FcmPushProvider, isInvalidTokenError } from './fcm-push.provider';

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

  it('returns a retryable failure with invalidTokens when every token is unregistered', async () => {
    const { provider: push } = provider([
      { success: false, error: { code: 'UNREGISTERED' } },
      { success: false, error: { errorInfo: { code: 'messaging/invalid-registration-token' } } },
    ]);

    const result = await push.send(payload);

    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
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
