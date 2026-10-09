import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const protectedRoots = [
  join(webRoot, 'src/server/database/seeders'),
  join(webRoot, 'scripts/smoke'),
];

const LITERAL_PASSWORD_PATTERNS = [
  /\bpassword(?:_hash)?\s*:\s*(['"`])/i,
  /\b\w*(?:password|passphrase)\w*\s*=\s*(['"`])/i,
  /\bbcrypt\.hash\s*\(\s*(['"`])/i,
];

function* typescriptFiles(directory: string): Generator<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* typescriptFiles(path);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      yield path;
    }
  }
}

describe('credential hardening in seeders and smoke scripts', () => {
  it('requires explicit platform-admin credentials and opts demo seeders in', () => {
    const platformSeeder = readFileSync(
      join(webRoot, 'src/server/database/seeders/20260828160000-platform-super-admin.ts'),
      'utf8',
    );
    assert.equal(platformSeeder.includes('DEFAULT_DEV_EMAIL'), false);
    assert.equal(platformSeeder.includes('DEFAULT_DEV_PASSWORD'), false);
    assert.equal(
      platformSeeder.includes('normalizeSuperAdminEmail(process.env.SUPER_ADMIN_EMAIL)'),
      true,
    );
    assert.equal(platformSeeder.includes('process.env.SUPER_ADMIN_PASSWORD'), true);

    for (const seederName of [
      '20260827120800-demo-core-domain-data.ts',
      '20260905120000-four-dummy-schools.ts',
    ]) {
      const seeder = readFileSync(join(webRoot, 'src/server/database/seeders', seederName), 'utf8');
      assert.equal(seeder.includes("process.env.NODE_ENV === 'production'"), true);
      assert.equal(seeder.includes("process.env.ALLOW_DEMO_SEED !== '1'"), true);
    }
  });

  it('contains no literal password values or Gmail addresses', () => {
    const violations: string[] = [];

    for (const root of protectedRoots) {
      for (const file of typescriptFiles(root)) {
        const relativePath = file.slice(webRoot.length + 1);
        const source = readFileSync(file, 'utf8');

        if (/@gmail\.com\b/i.test(source)) {
          violations.push(`${relativePath} contains a Gmail address`);
        }
        if (LITERAL_PASSWORD_PATTERNS.some((pattern) => pattern.test(source))) {
          violations.push(`${relativePath} contains a literal password value`);
        }
      }
    }

    assert.deepEqual(violations, [], violations.join('\n'));
  });
});
