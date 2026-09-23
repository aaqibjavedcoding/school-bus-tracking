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

/**
 * The selection must never be silent: production without a push rail logs an
 * unmissable error at provider construction, and an active rail is named in
 * the boot log so a deployment can verify FCM is really live.
 */
describe('createPushProvider selection logging', () => {
  const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
  const ORIGINAL_LOG_SILENT = process.env.LOG_SILENT;

  function withCapturedConsole(
    nodeEnv: string,
    run: () => void,
  ): { errors: string[]; logs: string[] } {
    const errors: string[] = [];
    const logs: string[] = [];
    const originalError = console.error;
    const originalLog = console.log;
    process.env.NODE_ENV = nodeEnv;
    delete process.env.LOG_SILENT; // the guard under test speaks through the console
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(' '));
    try {
      run();
    } finally {
      console.error = originalError;
      console.log = originalLog;
      if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
      if (ORIGINAL_LOG_SILENT === undefined) delete process.env.LOG_SILENT;
      else process.env.LOG_SILENT = ORIGINAL_LOG_SILENT;
    }
    return { errors, logs };
  }

  it('logs an unmissable error when the NoOp would run in production', () => {
    const { errors, logs } = withCapturedConsole('production', () => {
      const provider = createPushProvider({});
      assert.equal(provider.name, 'noop-push');
    });
    assert.equal(errors.length, 1, 'exactly one loud error at selection');
    assert.match(errors[0], /PUSH DELIVERY IS DISABLED IN PRODUCTION/);
    assert.match(errors[0], /NoOpPushProvider/);
    assert.match(errors[0], /FIREBASE_SERVICE_ACCOUNT_JSON/);
    assert.deepEqual(logs, [], 'no informational log softens the error');
  });

  it('names the active FCM rail when credentials are present in production', () => {
    const { errors, logs } = withCapturedConsole('production', () => {
      const provider = createPushProvider({ serviceAccountJson: SERVICE_ACCOUNT_JSON });
      assert.equal(provider.name, 'push-router');
    });
    assert.deepEqual(errors, [], 'no error when a rail is active');
    assert.ok(
      logs.some((line) => /Push rails active: Android FCM/.test(line)),
      `expected the active rail in the log, got: ${logs.join(' | ')}`,
    );
  });

  it('logs the NoOp informationally outside production', () => {
    const { errors, logs } = withCapturedConsole('development', () => {
      const provider = createPushProvider({});
      assert.equal(provider.name, 'noop-push');
    });
    assert.deepEqual(errors, [], 'dev/CI must not page anyone');
    assert.ok(logs.some((line) => /NoOpPushProvider active/.test(line)));
  });
});
