import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import type { PushNotificationPayload } from './notification-provider.interface';
import { ApnsDirectProvider, type ApnsRequestFn } from './apns-direct.provider';

// A real ES256 P-256 key — providerToken() signs with it, so the fake `.p8`
// lookalike string is not enough here.
function realApnsKey(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
}

const OPTIONS = {
  keyPem: realApnsKey(),
  keyId: 'ABC1234567',
  teamId: 'TEAM123456',
  topic: 'com.schoolbustracking.app',
  production: true,
};

function requestFn(handler: ApnsRequestFn): { fn: ApnsRequestFn; records: string[][] } {
  const records: string[][] = [];
  const fn: ApnsRequestFn = async (url, headers, body) => {
    records.push([url, headers['apns-topic'] ?? '', headers['apns-push-type'] ?? '']);
    return handler(url, headers, body);
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

describe('ApnsDirectProvider.send', () => {
  it('delivers an alert to APNs with topic and push-type headers', async () => {
    const { fn, records } = requestFn(async () => ({ status: 200, reason: '' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    const result = await provider.send(payload);

    assert.equal(result.success, true);
    assert.deepEqual(result.deviceOutcome?.delivered, ['ios-1']);
    assert.equal(records.length, 1);
    assert.match(records[0][0], /^https:\/\/[^/]+\/3\/device\/ios-1$/);
    assert.equal(records[0][1], 'com.schoolbustracking.app');
    assert.equal(records[0][2], 'alert');
  });

  it('maps a 410 Gone to an invalid token (retired, not retried)', async () => {
    const { fn } = requestFn(async () => ({ status: 410, reason: 'Unregistered' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    const result = await provider.send(payload);

    assert.equal(result.success, false);
    assert.deepEqual(result.invalidTokens, ['ios-1']);
    assert.equal(result.retryable, false);
    assert.equal(result.delivery?.permanent, true);
  });

  it('maps a 400 BadDeviceToken to an invalid token', async () => {
    const { fn } = requestFn(async () => ({ status: 400, reason: 'BadDeviceToken' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    const result = await provider.send(payload);

    assert.deepEqual(result.invalidTokens, ['ios-1']);
    assert.equal(result.retryable, false);
  });

  it('maps 403/429/5xx to a retryable failure', async () => {
    for (const status of [403, 429, 503]) {
      const { fn } = requestFn(async () => ({ status, reason: 'BadProviderToken' }));
      const provider = new ApnsDirectProvider(OPTIONS, fn);
      const result = await provider.send(payload);
      assert.equal(result.success, false, `status ${status}`);
      assert.equal(result.retryable, true, `status ${status} retryable`);
      assert.deepEqual(result.deviceOutcome?.retryable, ['ios-1']);
    }
  });

  it('reports partial success across a mixed batch', async () => {
    const statuses = [200, 410];
    let index = 0;
    const { fn } = requestFn(async () => ({ status: statuses[index++], reason: '' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    const result = await provider.send({ ...payload, deviceTokens: ['good', 'stale'] });

    assert.equal(result.success, true, 'one accepted device = row-level success');
    assert.deepEqual(result.deviceOutcome?.delivered, ['good']);
    assert.deepEqual(result.deviceOutcome?.invalid, ['stale']);
  });

  it('refuses to send Android tokens through APNs (notConfigured, never delivered late)', async () => {
    let called = false;
    const { fn } = requestFn(async () => ((called = true), { status: 200, reason: '' }));
    const provider = new ApnsDirectProvider(OPTIONS, fn);

    const result = await provider.send({
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
