import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserRole } from '@school-bus-tracking/shared-types';
import { MANAGED_NAV_ITEMS, canAccessPath, navItemsForRole, type NavItem } from './roles.ts';

/**
 * Every sidebar destination must exist as an App Router page.
 *
 * A nav entry whose route has no `page.tsx` renders a link that 404s — which
 * is exactly how "Manage Data → Parents & Guardians" broke: `MANAGED_NAV_ITEMS`
 * advertised `/parents`, the guard allowed it and the API had the matching
 * assisted-management controller, but the web app had no
 * `app/(authenticated)/parents/page.tsx`, so Next.js answered 404.
 *
 * Asserting the nav against the filesystem catches the whole class of bug for
 * every role at once, instead of one screen at a time.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(here, '..', 'app', '(authenticated)');

/** Filesystem path of the App Router page backing an authenticated href. */
function pageFileFor(href: string): string {
  const segments = href === '/' ? [] : href.replace(/^\//, '').split('/');
  return path.join(APP_DIR, ...segments, 'page.tsx');
}

const ALL_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.SCHOOL_ADMIN,
  UserRole.DRIVER,
  UserRole.CONDUCTOR,
  UserRole.PARENT,
];

function everyNavItem(): Array<{ role: string; item: NavItem }> {
  const entries: Array<{ role: string; item: NavItem }> = [];
  for (const role of ALL_ROLES) {
    for (const item of navItemsForRole(role)) {
      entries.push({ role, item });
    }
  }
  for (const item of MANAGED_NAV_ITEMS) {
    entries.push({ role: 'SUPER_ADMIN (assisted management)', item });
  }
  return entries;
}

describe('sidebar navigation targets', () => {
  it('renders a real page for every nav entry of every role', () => {
    const missing = everyNavItem()
      .filter(({ item }) => !fs.existsSync(pageFileFor(item.href)))
      .map(({ role, item }) => `${role} → ${item.label} (${item.href})`);

    assert.deepEqual(missing, [], `nav entries without a page.tsx:\n${missing.join('\n')}`);
  });

  it('routes every assisted-management section the Super Admin can reach', () => {
    // The managed sidebar is the Super Admin's only way into the tenant
    // workspace, so each of its entries must both exist and pass the guard.
    for (const item of MANAGED_NAV_ITEMS) {
      assert.ok(fs.existsSync(pageFileFor(item.href)), `${item.href} has a page`);
      assert.equal(
        canAccessPath(UserRole.SUPER_ADMIN, item.href, true),
        true,
        `${item.href} is allowed while managing`,
      );
    }
  });
});

describe('Parents / Guardians section', () => {
  const PARENTS_PAGE = pageFileFor('/parents');

  it('is listed in the assisted-management sidebar and backed by a page', () => {
    const entry = MANAGED_NAV_ITEMS.find((item) => item.href === '/parents');
    assert.ok(entry, 'the managed sidebar offers Parents / Guardians');
    assert.match(entry.label, /parents/i);
    assert.ok(fs.existsSync(PARENTS_PAGE), 'app/(authenticated)/parents/page.tsx exists');
  });

  it('is a client page driven by the shared api client, not a bespoke fetch', () => {
    const source = fs.readFileSync(PARENTS_PAGE, 'utf8');
    assert.match(source, /^'use client';/, 'client component');
    assert.match(source, /from '\.\.\/\.\.\/\.\.\/services\/api'/, 'uses the shared apiClient');
    // Reusing the shared client is what makes the managed remap (and therefore
    // tenant isolation) work without this page knowing anything about it.
    assert.match(source, /apiClient\.listParents\(/);
    assert.doesNotMatch(source, /\bfetch\(/, 'never calls fetch directly');
    // The page must not invent a tenant claim of its own.
    assert.doesNotMatch(source, /school_id\s*:/, 'never sends a school_id');
  });
});
