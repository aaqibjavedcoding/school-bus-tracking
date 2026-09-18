import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import type {
  PushDeliveryResult,
  PushNotificationPayload,
} from './notification-provider.interface';
import { PushDeliveryRouter } from './push-delivery-router';

class RecordingProvider {
  readonly name: string;
  readonly isConfigured = true;
  readonly calls: PushNotificationPayload[] = [];
  constructor(
    name: string,
    public readonly sendImpl?: (p: PushNotificationPayload) => Promise<PushDeliveryResult>,
  ) {
    this.name = name;
  }

  async send(payload: PushNotificationPayload): Promise<PushDeliveryResult> {
    this.calls.push(payload);
    if (this.sendImpl) {
      return this.sendImpl(payload);
    }
    return {
      success: true,
      provider: this.name,
      messageId: `${this.name}-ok`,
      retryable: false,
      deviceOutcome: {
        delivered: [...payload.deviceTokens],
        retryable: [],
        invalid: [],
        notConfigured: [],
      },
    };
  }

  async sendBatch(payloads: PushNotificationPayload[]): Promise<PushDeliveryResult[]> {
    const results: PushDeliveryResult[] = [];
    for (const p of payloads) {
      results.push(await this.send(p));
    }
    return results;
  }
}

const payload = (
  tokens: string[],
  platforms: Array<'android' | 'ios' | null>,
): PushNotificationPayload => ({
  recipientId: 'u1',
  title: 'x',
  body: 'y',
  data: { id: 'n1' },
  deviceTokens: tokens,
  tokenPlatforms: platforms,
  priority: 'high',
});

describe('PushDeliveryRouter platform partitioning', () => {
  it('routes Android tokens to FCM and never sends them to APNs', async () => {
    const fcm = new RecordingProvider('fcm');
    const apns = new RecordingProvider('apns');
    const router = new PushDeliveryRouter(fcm, apns);

    const result = await router.send(payload(['a1', 'a2', 'i1'], ['android', 'android', 'ios']));

    assert.equal(result.success, true);
    assert.deepEqual(fcm.calls[0].deviceTokens, ['a1', 'a2']);
    assert.deepEqual(apns.calls[0].deviceTokens, ['i1']);
    assert.deepEqual(result.deviceOutcome?.delivered.sort(), ['a1', 'a2', 'i1']);
  });

  it('routes null-platform tokens to FCM as the legacy fallback', async () => {
    const fcm = new RecordingProvider('fcm');
    const apns = new RecordingProvider('apns');
    const router = new PushDeliveryRouter(fcm, apns);

    await router.send(payload(['legacy-1', 'i1'], [null, 'ios']));

    assert.deepEqual(fcm.calls[0].deviceTokens, ['legacy-1']);
    assert.deepEqual(apns.calls[0].deviceTokens, ['i1']);
  });

  it('reports iOS devices as not_configured when no APNs provider is wired (never sent to FCM)', async () => {
    const fcm = new RecordingProvider('fcm');
    const router = new PushDeliveryRouter(fcm, null);

    const result = await router.send(payload(['a1', 'ios-1'], ['android', 'ios']));

    assert.equal(result.success, true, 'the Android rail still delivered');
    assert.deepEqual(fcm.calls[0].deviceTokens, ['a1']);
    assert.deepEqual(result.deviceOutcome?.notConfigured, ['ios-1']);
  });

  it('reports a failed but honest outcome when iOS-only and no APNs provider exists', async () => {
    const router = new PushDeliveryRouter(null, null);
    // not configured at all → isConfigured false, but the router is only built with a rail.
    const result = await router.send(payload(['ios-1'], ['ios']));
    assert.equal(result.success, false);
    assert.equal(result.retryable, false);
    assert.equal(result.delivery?.permanent, true);
  });

  it('degrades a throwing rail to a retryable outcome instead of throwing out', async () => {
    const fcm = new RecordingProvider('fcm', async () => {
      throw new Error('boom');
    });
    const router = new PushDeliveryRouter(fcm, null);

    const result = await router.send(payload(['a1'], ['android']));

    assert.equal(result.success, false);
    assert.equal(result.retryable, true);
    assert.deepEqual(result.deviceOutcome?.retryable, ['a1']);
  });

  it('merges partial success across rails for per-device accounting', async () => {
    const fcm = new RecordingProvider('fcm', async (p) => ({
      success: true,
      provider: 'fcm',
      retryable: false,
      invalidTokens: [p.deviceTokens[1]],
      deviceOutcome: {
        delivered: [p.deviceTokens[0]],
        retryable: [],
        invalid: [p.deviceTokens[1]],
        notConfigured: [],
      },
    }));
    const apns = new RecordingProvider('apns');
    const router = new PushDeliveryRouter(fcm, apns);

    const result = await router.send(payload(['a1', 'a2', 'i1'], ['android', 'android', 'ios']));

    assert.equal(result.success, true);
    assert.deepEqual(result.invalidTokens, ['a2']);
    assert.deepEqual(result.deviceOutcome?.delivered.sort(), ['a1', 'i1']);
  });
});
