import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { canEnterGroup, crewRoleLabel, homeRoute, isCrewRole } from './roles.ts';

/**
 * Role-based navigation guards. The API is the real boundary (401/403), but
 * the router must never even render another role's experience.
 */
describe('homeRoute', () => {
  it('lands every role on its own experience', () => {
    assert.equal(homeRoute(UserRole.DRIVER), '/trip');
    assert.equal(homeRoute(UserRole.CONDUCTOR), '/trip');
    assert.equal(homeRoute(UserRole.PARENT), '/home');
    assert.equal(homeRoute(UserRole.SCHOOL_ADMIN), '/today');
    assert.equal(homeRoute(UserRole.SUPER_ADMIN), '/platform');
  });
});

describe('canEnterGroup', () => {
  it('lets only crew roles into the shared crew group', () => {
    assert.equal(canEnterGroup(UserRole.DRIVER, 'crew'), true);
    assert.equal(canEnterGroup(UserRole.CONDUCTOR, 'crew'), true);
    assert.equal(canEnterGroup(UserRole.PARENT, 'crew'), false);
    assert.equal(canEnterGroup(UserRole.SCHOOL_ADMIN, 'crew'), false);
    assert.equal(canEnterGroup(null, 'crew'), false);
  });

  it('lets only parents into the parent group', () => {
    assert.equal(canEnterGroup(UserRole.PARENT, 'parent'), true);
    assert.equal(canEnterGroup(UserRole.DRIVER, 'parent'), false);
    assert.equal(canEnterGroup(UserRole.SUPER_ADMIN, 'parent'), false);
  });

  it('lets only school admins into the admin group', () => {
    assert.equal(canEnterGroup(UserRole.SCHOOL_ADMIN, 'admin'), true);
    assert.equal(canEnterGroup(UserRole.SUPER_ADMIN, 'admin'), false);
    assert.equal(canEnterGroup(UserRole.PARENT, 'admin'), false);
  });
});

describe('crew role helpers', () => {
  it('treats driver and conductor as crew, super admin as not', () => {
    assert.equal(isCrewRole(UserRole.DRIVER), true);
    assert.equal(isCrewRole(UserRole.CONDUCTOR), true);
    assert.equal(isCrewRole(UserRole.SUPER_ADMIN), false);
  });

  it('labels the shared experience by role', () => {
    assert.equal(crewRoleLabel(UserRole.DRIVER), 'Driver');
    assert.equal(crewRoleLabel(UserRole.CONDUCTOR), 'Conductor');
  });
});
