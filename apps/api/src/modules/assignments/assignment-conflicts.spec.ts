import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { RouteAssignmentRole } from '@school-bus-tracking/shared-types';
import { findAssignmentConflict, type AssignmentCandidate } from './assignment-conflicts';
import {
  ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE,
  ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE,
} from './assignments.constants';

const ROUTE_A = '11111111-1111-4111-8111-111111111111';
const ROUTE_B = '22222222-2222-4222-8222-222222222222';
const BUS_A = '33333333-3333-4333-8333-333333333333';
const BUS_B = '44444444-4444-4444-8444-444444444444';
const DRIVER_A = '55555555-5555-4555-8555-555555555555';
const CONDUCTOR_A = '66666666-6666-4666-8666-666666666666';

function row(overrides: Partial<AssignmentCandidate> = {}): AssignmentCandidate {
  return {
    route_id: ROUTE_A,
    bus_id: BUS_A,
    user_id: DRIVER_A,
    role: RouteAssignmentRole.DRIVER,
    effective_from: '2026-08-27',
    effective_to: null,
    is_active: true,
    ...overrides,
  };
}

function conflict(overrides: Partial<AssignmentCandidate> = {}): AssignmentCandidate {
  return row(overrides);
}

describe('findAssignmentConflict', () => {
  it('keeps the driver + conductor pair on one route legal', () => {
    const driver = row();
    const conductor = conflict({
      user_id: CONDUCTOR_A,
      role: RouteAssignmentRole.CONDUCTOR,
    });
    assert.equal(findAssignmentConflict(driver, conductor), null);
  });

  it('keeps one person in both roles on the same route legal', () => {
    const driver = row();
    const conductor = conflict({
      user_id: DRIVER_A,
      role: RouteAssignmentRole.CONDUCTOR,
    });
    assert.equal(findAssignmentConflict(driver, conductor), null);
  });

  it('rejects the same person on two routes during an overlap', () => {
    const other = conflict({ route_id: ROUTE_B, bus_id: BUS_B });
    const found = findAssignmentConflict(row(), other);
    assert.equal(found?.kind, 'CREW_ROUTE');
    assert.equal(found?.message, ROUTE_ASSIGNMENT_CREW_ROUTE_CONFLICT_MESSAGE);
  });

  it('rejects the same person on two routes regardless of role pair', () => {
    const driver = row();
    const conductor = conflict({
      route_id: ROUTE_B,
      bus_id: BUS_B,
      user_id: DRIVER_A,
      role: RouteAssignmentRole.CONDUCTOR,
    });
    assert.equal(findAssignmentConflict(driver, conductor)?.kind, 'CREW_ROUTE');
  });

  it('allows the same person on two routes with non-overlapping periods', () => {
    const current = row({ effective_from: '2026-01-01', effective_to: '2026-06-30' });
    const next = conflict({
      route_id: ROUTE_B,
      bus_id: BUS_B,
      effective_from: '2026-07-01',
      effective_to: null,
    });
    assert.equal(findAssignmentConflict(current, next), null);
  });

  it('treats effective periods as inclusive on both ends', () => {
    const current = row({ effective_from: '2026-01-01', effective_to: '2026-06-30' });
    const touching = conflict({
      route_id: ROUTE_B,
      bus_id: BUS_B,
      effective_from: '2026-06-30',
      effective_to: '2026-12-31',
    });
    assert.equal(findAssignmentConflict(current, touching)?.kind, 'CREW_ROUTE');
  });

  it('never conflicts for inactive rows', () => {
    const current = row();
    const inactive = conflict({ route_id: ROUTE_B, bus_id: BUS_B, is_active: false });
    assert.equal(findAssignmentConflict(current, inactive), null);
    assert.equal(
      findAssignmentConflict(row({ is_active: false }), conflict({ route_id: ROUTE_B })),
      null,
    );
  });

  it('reports the route-role conflict before the crew conflict', () => {
    const found = findAssignmentConflict(row(), conflict());
    assert.equal(found?.kind, 'ROUTE_ROLE');
    assert.equal(found?.message, ROUTE_ASSIGNMENT_ROUTE_ROLE_CONFLICT_MESSAGE);
  });

  it('reports the bus conflict before the crew conflict when the bus is shared', () => {
    const found = findAssignmentConflict(row(), conflict({ route_id: ROUTE_B }));
    assert.equal(found?.kind, 'BUS');
    assert.equal(found?.message, ROUTE_ASSIGNMENT_BUS_CONFLICT_MESSAGE);
  });

  it('reports a route switching buses during an overlap', () => {
    const current = row({ user_id: CONDUCTOR_A, role: RouteAssignmentRole.CONDUCTOR });
    const found = findAssignmentConflict(
      current,
      conflict({ user_id: DRIVER_A, bus_id: BUS_B, role: RouteAssignmentRole.DRIVER }),
    );
    assert.equal(found?.kind, 'ROUTE_BUS');
    assert.equal(found?.message, ROUTE_ASSIGNMENT_ROUTE_BUS_CONFLICT_MESSAGE);
  });

  it('allows two different crew members on two different routes', () => {
    const other = conflict({
      route_id: ROUTE_B,
      bus_id: BUS_B,
      user_id: CONDUCTOR_A,
      role: RouteAssignmentRole.CONDUCTOR,
    });
    assert.equal(findAssignmentConflict(row(), other), null);
  });
});
