import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { createPushProvider } from './push-provider.factory';

const SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'demo-project',
  private_key: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
  client_email: 'push@demo-project.iam.gserviceaccount.com',
});

/**
 * Provider selection is driven purely by the Firebase env. Without a valid
 * service-account JSON the NoOp provider MUST be selected so local dev and
 * CI pass unchanged; with it the free FCM provider is wired.
 */
describe('createPushProvider selection', () => {
  it('selects NoOpPushProvider when FIREBASE_SERVICE_ACCOUNT_JSON is absent', () => {
    const provider = createPushProvider({});
    assert.equal(provider.name, 'noop-push');
  });

  it('selects NoOpPushProvider for whitespace-only input', () => {
    const provider = createPushProvider({ serviceAccountJson: '   \n ' });
    assert.equal(provider.name, 'noop-push');
  });

  it('selects the platform router (FCM rail) for a valid service-account JSON', () => {
    const provider = createPushProvider({
      serviceAccountJson: SERVICE_ACCOUNT_JSON,
      projectId: 'demo-project',
    });
    // Phase 2 composite: the router is the provider the app talks to.
    assert.equal(provider.name, 'push-router');
    assert.equal(provider.isConfigured, true);
  });

  it('selects the platform router (APNs rail) when full APNs credentials are present', () => {
    const provider = createPushProvider({
      apnsKeyPem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
      apnsKeyId: 'ABC1234567',
      apnsTeamId: 'TEAM123456',
      apnsTopic: 'com.schoolbustracking.app',
    });
    assert.equal(provider.name, 'push-router');
    assert.equal(provider.isConfigured, true);
  });

  it('falls back to NoOpPushProvider when APNs credentials are incomplete (never pretends success)', () => {
    const provider = createPushProvider({
      apnsKeyPem: '-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n',
      apnsKeyId: 'ABC1234567',
      // missing team id + topic
    });
    assert.equal(provider.name, 'noop-push');
  });

  it('falls back to NoOpPushProvider when the JSON is malformed (value never logged)', () => {
    const provider = createPushProvider({ serviceAccountJson: '{not-json' });
    assert.equal(provider.name, 'noop-push');
  });

  it('falls back to NoOpPushProvider for a non-object JSON value', () => {
    const provider = createPushProvider({ serviceAccountJson: '["not","an","object"]' });
    assert.equal(provider.name, 'noop-push');
  });
});
