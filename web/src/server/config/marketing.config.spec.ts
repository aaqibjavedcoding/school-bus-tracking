import { afterEach, describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import marketingConfig, { isMarketingTestRecipient, parseEmailList } from './marketing.config';

const trackedKeys = [
  'MARKETING_ADMIN_EMAILS',
  'MARKETING_TEST_RECIPIENTS',
  'MARKETING_WORKER_ENABLED',
  'MARKETING_WORKER_INTERVAL_MS',
  'MARKETING_WORKER_INITIAL_DELAY_MS',
  'MARKETING_WORKER_BATCH_SIZE',
  'MARKETING_DELIVERY_MAX_ATTEMPTS',
  'MARKETING_DELIVERY_BASE_BACKOFF_MS',
] as const;

const originals = new Map<string, string | undefined>(
  trackedKeys.map((key) => [key, process.env[key]]),
);

function setEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of trackedKeys) {
    setEnv(key, originals.get(key));
  }
});

describe('parseEmailList', () => {
  it('parses a comma-separated list, trimmed, lowercased, deduplicated', () => {
    assert.deepEqual(
      parseEmailList(' ZeroMileSystems@Gmail.com , zeromilesystems@gmail.com ; ops@example.io'),
      ['zeromilesystems@gmail.com', 'ops@example.io'],
    );
  });

  it('returns an empty list for unset, empty or whitespace-only input', () => {
    assert.deepEqual(parseEmailList(undefined), []);
    assert.deepEqual(parseEmailList(''), []);
    assert.deepEqual(parseEmailList('   '), []);
  });

  it('drops entries that are not email addresses instead of failing the list', () => {
    assert.deepEqual(parseEmailList('not-an-email,,  @missing.local , ok@example.com'), [
      'ok@example.com',
    ]);
  });
});

describe('isMarketingTestRecipient — the test-send gate', () => {
  const allowed = ['zeromilesystems@gmail.com', 'ops@zeromile.example'];

  it('accepts an exact configured address, case- and whitespace-insensitively', () => {
    assert.equal(isMarketingTestRecipient('zeromilesystems@gmail.com', allowed), true);
    assert.equal(isMarketingTestRecipient('  ZeroMileSystems@Gmail.COM ', allowed), true);
  });

  it('rejects addresses that are merely similar — no substring or domain matching', () => {
    // A test recipient must never widen the set by association.
    assert.equal(isMarketingTestRecipient('principal@school.edu', allowed), false);
    assert.equal(isMarketingTestRecipient('zeromilesystems@gmail.com.evil.io', allowed), false);
    assert.equal(isMarketingTestRecipient('xzeromilesystems@gmail.com', allowed), false);
    assert.equal(isMarketingTestRecipient('marketing@zeromile.example', allowed), false);
    assert.equal(isMarketingTestRecipient('', allowed), false);
  });

  it('rejects everything when no test recipients are configured', () => {
    assert.equal(isMarketingTestRecipient('zeromilesystems@gmail.com', []), false);
  });
});

describe('marketingConfig', () => {
  it('reads the admin and test recipient lists from the environment', () => {
    process.env.MARKETING_ADMIN_EMAILS = ' zeromilesystems@gmail.com , ops@zeromile.example ';
    process.env.MARKETING_TEST_RECIPIENTS = 'zeromilesystems@gmail.com';

    const config = marketingConfig();

    assert.deepEqual(config.adminEmails, ['zeromilesystems@gmail.com', 'ops@zeromile.example']);
    assert.deepEqual(config.testRecipients, ['zeromilesystems@gmail.com']);
  });

  it('never hard-codes a fallback address — unset means empty', () => {
    delete process.env.MARKETING_ADMIN_EMAILS;
    delete process.env.MARKETING_TEST_RECIPIENTS;

    const config = marketingConfig();

    // The address lives in the environment (web/.env.example documents it),
    // never in business logic. An unset variable must not conjure one.
    assert.deepEqual(config.adminEmails, []);
    assert.deepEqual(config.testRecipients, []);
  });

  it('exposes no SMTP secret of its own — the email namespace owns those', () => {
    const config = marketingConfig();
    const keys = Object.keys(config);
    for (const forbidden of ['smtpPass', 'smtpUser', 'smtpHost', 'pass', 'password']) {
      assert.equal(keys.includes(forbidden), false, `${forbidden} must not live here`);
    }
  });

  it('applies the documented worker defaults', () => {
    for (const key of [
      'MARKETING_WORKER_ENABLED',
      'MARKETING_WORKER_INTERVAL_MS',
      'MARKETING_WORKER_INITIAL_DELAY_MS',
      'MARKETING_WORKER_BATCH_SIZE',
      'MARKETING_DELIVERY_MAX_ATTEMPTS',
      'MARKETING_DELIVERY_BASE_BACKOFF_MS',
    ]) {
      setEnv(key, undefined);
    }

    const config = marketingConfig();

    assert.equal(config.worker.enabled, true);
    assert.equal(config.worker.intervalMs, 60_000);
    assert.equal(config.worker.initialDelayMs, 30_000);
    assert.equal(config.worker.batchSize, 25);
    assert.equal(config.delivery.maxAttempts, 5);
    assert.equal(config.delivery.baseBackoffMs, 60_000);
  });

  it('honours explicit overrides and ignores invalid values (safe defaults win)', () => {
    process.env.MARKETING_WORKER_ENABLED = 'false';
    process.env.MARKETING_WORKER_INTERVAL_MS = '5000';
    process.env.MARKETING_WORKER_BATCH_SIZE = '10';
    process.env.MARKETING_DELIVERY_MAX_ATTEMPTS = '3';
    process.env.MARKETING_DELIVERY_BASE_BACKOFF_MS = 'not-a-number';

    const config = marketingConfig();

    assert.equal(config.worker.enabled, false);
    assert.equal(config.worker.intervalMs, 5000);
    assert.equal(config.worker.batchSize, 10);
    assert.equal(config.delivery.maxAttempts, 3);
    // A mistyped value degrades to the default instead of NaN/0.
    assert.equal(config.delivery.baseBackoffMs, 60_000);
  });

  it('rejects zero/negative numbers in favour of the defaults', () => {
    process.env.MARKETING_WORKER_INTERVAL_MS = '0';
    process.env.MARKETING_WORKER_BATCH_SIZE = '-5';

    const config = marketingConfig();

    assert.equal(config.worker.intervalMs, 60_000);
    assert.equal(config.worker.batchSize, 25);
  });
});
