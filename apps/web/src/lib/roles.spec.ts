import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { activeNavHref, canAccessPath, homePath, navItemsForRole } from './roles.ts';

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
