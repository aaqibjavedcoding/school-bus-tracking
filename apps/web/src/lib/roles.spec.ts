import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import {
  MANAGED_NAV_ITEMS,
  activeNavHref,
  canAccessPath,
  homePath,
  navItemsForRole,
} from './roles.ts';

/**
 * Guard regressions are invisible in the UI: an allowed screen that the guard
 * rejects simply bounces the user back to their home page (which is exactly
 * how the crew "Documents" action used to break).
 */
describe('canAccessPath', () => {
  it('lets a school admin open the deep links reachable from the sidebar', () => {
    for (const path of [
      '/',
      '/staff',
      '/buses/bus-1/documents',
      '/drivers/driver-1/documents',
      '/students',
      '/documents',
    ]) {
      assert.equal(canAccessPath(UserRole.SCHOOL_ADMIN, path), true, path);
    }
  });

  it('keeps a school admin out of the platform console and the parent area', () => {
    assert.equal(canAccessPath(UserRole.SCHOOL_ADMIN, '/admin'), false);
    assert.equal(canAccessPath(UserRole.SCHOOL_ADMIN, '/parent'), false);
  });

  it('keeps crew and parents inside their own workspace', () => {
    assert.equal(canAccessPath(UserRole.DRIVER, '/crew'), true);
    assert.equal(canAccessPath(UserRole.DRIVER, '/drivers/driver-1/documents'), false);
    assert.equal(canAccessPath(UserRole.PARENT, '/children/child-1'), true);
    assert.equal(canAccessPath(UserRole.PARENT, '/staff'), false);
  });

  it('sends the platform admin to the console and school roles to their home', () => {
    assert.equal(homePath(UserRole.SUPER_ADMIN), '/admin');
    assert.equal(homePath(UserRole.SCHOOL_ADMIN), '/');
    assert.equal(homePath(UserRole.CONDUCTOR), '/crew');
  });

  it('gives the platform admin the global subscriptions console', () => {
    const items = navItemsForRole(UserRole.SUPER_ADMIN).map((item) => item.href);
    assert.ok(items.includes('/admin/subscriptions'));
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/admin/subscriptions'), true);
    assert.equal(canAccessPath(UserRole.SCHOOL_ADMIN, '/admin/subscriptions'), false);
  });

  it('never gives a school user the platform admin pages', () => {
    assert.equal(canAccessPath(UserRole.DRIVER, '/admin'), false);
    assert.equal(canAccessPath(UserRole.CONDUCTOR, '/admin/schools'), false);
    assert.equal(canAccessPath(UserRole.PARENT, '/admin/plans'), false);
  });
});

describe('platform console navigation', () => {
  it('exposes the revenue overview to the platform admin only', () => {
    const items = navItemsForRole(UserRole.SUPER_ADMIN).map((item) => item.href);
    assert.ok(items.includes('/admin/revenue'));
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/admin/revenue'), true);
    assert.equal(canAccessPath(UserRole.SCHOOL_ADMIN, '/admin/revenue'), false);
    assert.equal(canAccessPath(UserRole.PARENT, '/admin/revenue'), false);
  });

  it('highlights only the deepest matching nav section', () => {
    const items = navItemsForRole(UserRole.SUPER_ADMIN);
    assert.equal(activeNavHref(items, '/admin'), '/admin');
    assert.equal(activeNavHref(items, '/admin/schools'), '/admin/schools');
    // Deep links keep their section highlighted after a refresh.
    assert.equal(activeNavHref(items, '/admin/schools/abc-123'), '/admin/schools');
    assert.equal(activeNavHref(items, '/admin/plans/new'), '/admin/plans');
    assert.equal(activeNavHref(items, '/nowhere'), null);
  });

  it('never treats the school dashboard root as a prefix match', () => {
    const items = navItemsForRole(UserRole.SCHOOL_ADMIN);
    assert.equal(activeNavHref(items, '/'), '/');
    assert.equal(activeNavHref(items, '/students'), '/students');
    assert.equal(activeNavHref(items, '/trips/42'), '/trips');
  });
});

/**
 * Assisted management ("Manage Data") lets the platform Super Admin work
 * inside one school's workspace. The guard is what decides whether a tenant
 * URL renders or bounces back to `/admin`, so the Parents / Guardians section
 * — the entry that used to 404 — is asserted here alongside its siblings.
 */
describe('assisted-management navigation', () => {
  it('offers Parents / Guardians in the managed sidebar', () => {
    const hrefs = MANAGED_NAV_ITEMS.map((item) => item.href);
    assert.ok(hrefs.includes('/parents'));
    assert.deepEqual(
      hrefs,
      navItemsForRole(UserRole.SUPER_ADMIN, true).map((item) => item.href),
    );
  });

  it('opens every managed section to the Super Admin while a context is active', () => {
    for (const { href } of MANAGED_NAV_ITEMS) {
      assert.equal(canAccessPath(UserRole.SUPER_ADMIN, href, true), true, href);
    }
  });

  it('keeps the managed sections shut without an active context', () => {
    // Without "Manage Data" the platform admin has no business in a tenant
    // workspace at all — a hand-typed /parents must bounce to /admin.
    for (const { href } of MANAGED_NAV_ITEMS) {
      assert.equal(canAccessPath(UserRole.SUPER_ADMIN, href, false), false, href);
    }
    assert.equal(homePath(UserRole.SUPER_ADMIN), '/admin');
  });

  it('survives a direct URL refresh on a managed section', () => {
    // A full reload re-runs the guard with the restored context; /parents and
    // its deep links must still render rather than redirect.
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/parents', true), true);
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/parents/parent-1', true), true);
    assert.equal(canAccessPath(UserRole.SUPER_ADMIN, '/students/student-1', true), true);
    // …and the section stays highlighted in the sidebar afterwards.
    assert.equal(activeNavHref(MANAGED_NAV_ITEMS, '/parents'), '/parents');
    assert.equal(activeNavHref(MANAGED_NAV_ITEMS, '/parents/parent-1'), '/parents');
    // `/parent` (the parent portal) must never light up the `/parents` entry.
    assert.equal(activeNavHref(MANAGED_NAV_ITEMS, '/parent'), null);
  });

  it('never opens out-of-scope areas, even while managing', () => {
    // The allowlist mirrors the API's assisted surface: the parent portal,
    // trips, tracking, documents, attendance and emergencies stay blocked.
    for (const path of [
      '/parent',
      '/parent/children',
      '/children/child-1',
      '/trips',
      '/tracking',
      '/documents',
      '/attendance',
      '/emergencies',
    ]) {
      assert.equal(canAccessPath(UserRole.SUPER_ADMIN, path, true), false, path);
    }
  });

  it('does not leak the managed sections to school roles', () => {
    // Tenant isolation runs the other way too: the managed flag is a Super
    // Admin concept and must not widen anybody else's access.
    assert.equal(canAccessPath(UserRole.PARENT, '/parents', true), false);
    assert.equal(canAccessPath(UserRole.DRIVER, '/parents', true), false);
    assert.equal(canAccessPath(UserRole.CONDUCTOR, '/parents', true), false);
    // A school admin reaches guardians through the student profile, not a
    // top-level section, so /parents is not part of their nav.
    assert.equal(
      navItemsForRole(UserRole.SCHOOL_ADMIN).some((item) => item.href === '/parents'),
      false,
    );
  });
});
