import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { canAccessPath, homePath, navItemsForRole } from './roles.ts';

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
