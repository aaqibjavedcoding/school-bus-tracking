import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('one-shot marketing worker command', () => {
  const script = readFileSync(resolve(process.cwd(), 'scripts/marketing-worker-once.ts'), 'utf8');
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  };

  it('is registered, runs one sweep, and always closes PostgreSQL', () => {
    assert.match(packageJson.scripts['marketing:worker:once'] ?? '', /marketing-worker-once\.ts/);
    assert.match(script, /marketingDeliveryWorker\(\)\.runOnce\(\)/);
    assert.match(script, /finally\s*{[\s\S]*sequelize\.close\(\)/);
  });

  it('prints only allowlisted summary metrics and uses a redacted fatal error', () => {
    assert.match(script, /JSON\.stringify/);
    for (const forbidden of [
      'SMTP_PASS',
      'normalized_email',
      'message.body',
      'clickToken',
      'unsubscribeToken',
    ]) {
      assert.equal(script.includes(forbidden), false, `${forbidden} must never be logged`);
    }
    assert.match(script, /failed during configuration or database startup/);
    assert.match(script, /process\.exitCode = 1/);
  });
});
