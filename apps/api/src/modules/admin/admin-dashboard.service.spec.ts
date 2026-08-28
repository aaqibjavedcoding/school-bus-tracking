import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AdminDashboardService } from './admin-dashboard.service';

/**
 * Verifies the dashboard rollup math over canned grouped COUNT rows. The
 * service issues exactly six grouped aggregate queries (no per-school
 * iteration); the stubs below emulate Postgres grouping rows.
 */
function rows(...data: Array<Record<string, unknown>>): Promise<unknown[]> {
  return Promise.resolve(data);
}

function makeService() {
  const queryCount: Record<string, number> = {
    schools: 0,
    users: 0,
    students: 0,
    buses: 0,
    routes: 0,
    trips: 0,
  };

  const sequelize = {
    fn: (name: string, col: unknown) => ({ fn: name, col }),
    col: (name: string) => name,
  };

  const schools = {
    sequelize,
    findAll: async () => {
      queryCount.schools += 1;
      return rows({ is_active: true, count: '3' }, { is_active: false, count: '1' });
    },
  };
  const users = {
    sequelize,
    findAll: async () => {
      queryCount.users += 1;
      // The single grouped query includes every role (no where filter).
      return rows(
        { role: UserRole.SCHOOL_ADMIN, count: '4' },
        { role: UserRole.DRIVER, count: '10' },
        { role: UserRole.CONDUCTOR, count: '8' },
        { role: UserRole.PARENT, count: '25' },
        { role: UserRole.SUPER_ADMIN, count: '2' },
      );
    },
  };
  const students = {
    sequelize,
    findAll: async () => {
      queryCount.students += 1;
      return rows({ count: '120' });
    },
  };
  const buses = {
    sequelize,
    findAll: async () => {
      queryCount.buses += 1;
      return rows({ is_active: true, count: '6' }, { is_active: false, count: '2' });
    },
  };
  const routes = {
    sequelize,
    findAll: async () => {
      queryCount.routes += 1;
      return rows({ is_active: true, count: '5' }, { is_active: false, count: '1' });
    },
  };
  const trips = {
    sequelize,
    findAll: async () => {
      queryCount.trips += 1;
      return rows(
        { status: 'SCHEDULED', count: '3' },
        { status: 'IN_PROGRESS', count: '2' },
        { status: 'COMPLETED', count: '50' },
        { status: 'CANCELLED', count: '4' },
      );
    },
  };

  const service = new AdminDashboardService(
    schools as never,
    users as never,
    students as never,
    buses as never,
    routes as never,
    trips as never,
  );
  return { service, queryCount };
}

describe('AdminDashboardService.getMetrics', () => {
  it('aggregates school, user and transport counts correctly', async () => {
    const { service } = makeService();
    const metrics = await service.getMetrics();

    assert.deepEqual(metrics.schools, { total: 4, active: 3, inactive: 1 });

    assert.equal(metrics.users.school_admins, 4);
    assert.equal(metrics.users.students, 120);
    assert.equal(metrics.users.parents, 25);
    assert.equal(metrics.users.drivers, 10);
    assert.equal(metrics.users.conductors, 8);
    assert.equal(metrics.users.super_admins, 2);
    // Total excludes the platform super admins.
    assert.equal(metrics.users.total, 4 + 120 + 25 + 10 + 8);

    assert.equal(metrics.transport.buses, 8);
    assert.equal(metrics.transport.active_buses, 6);
    assert.equal(metrics.transport.routes, 6);
    assert.equal(metrics.transport.active_routes, 5);
    assert.equal(metrics.transport.trips, 59);
    // Scheduled + in progress are the relevant live trips (boarding is 0).
    assert.equal(metrics.transport.active_trips, 5);

    assert.ok(!Number.isNaN(Date.parse(metrics.generated_at)));
  });

  it('uses a fixed number of aggregate queries (no N+1)', async () => {
    const { service, queryCount } = makeService();
    await service.getMetrics();
    // One grouped query per table, independent of school count.
    const total = Object.values(queryCount).reduce((a, b) => a + b, 0);
    assert.equal(total, 6);
    assert.equal(queryCount.schools, 1);
    assert.equal(queryCount.trips, 1);
  });
});
