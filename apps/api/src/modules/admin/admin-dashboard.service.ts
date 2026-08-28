import { Inject, Injectable } from '@nestjs/common';
import { AdminDashboardResponse, TripStatus, UserRole } from '@school-bus-tracking/shared-types';
import { Bus, Route, School, Student, Trip, User } from '../../database/models';
import {
  ADMIN_BUSES_REPOSITORY,
  ADMIN_ROUTES_REPOSITORY,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_STUDENTS_REPOSITORY,
  ADMIN_TRIPS_REPOSITORY,
  ADMIN_USERS_REPOSITORY,
} from './admin.constants';

/** Result of one grouped COUNT(*) query. */
type GroupCount = Record<string, number | string | boolean>;

/** Non-terminal trip states — the platform's "relevant" live trips. */
const ACTIVE_TRIP_STATUSES = [TripStatus.SCHEDULED, TripStatus.BOARDING, TripStatus.IN_PROGRESS];

/**
 * SaaS-level platform dashboard for the Super Admin console.
 *
 * All metrics come from a fixed set of grouped aggregate queries (six
 * queries total, independent of the number of schools or rows) — there is no
 * per-school iteration and no N+1. The response shape is intentionally flat
 * and additive so the next SaaS phase can attach subscription/revenue
 * metrics without reshaping it.
 */
@Injectable()
export class AdminDashboardService {
  constructor(
    @Inject(ADMIN_SCHOOLS_REPOSITORY) private readonly schools: typeof School,
    @Inject(ADMIN_USERS_REPOSITORY) private readonly users: typeof User,
    @Inject(ADMIN_STUDENTS_REPOSITORY) private readonly students: typeof Student,
    @Inject(ADMIN_BUSES_REPOSITORY) private readonly buses: typeof Bus,
    @Inject(ADMIN_ROUTES_REPOSITORY) private readonly routes: typeof Route,
    @Inject(ADMIN_TRIPS_REPOSITORY) private readonly trips: typeof Trip,
  ) {}

  async getMetrics(): Promise<AdminDashboardResponse> {
    const sequelize = this.schools.sequelize!;
    // Casts bridge the Sequelize typings for aggregate aliases — the runtime
    // shape is verified by the grouped-result parsing below.
    const count = (column: unknown) => sequelize.fn('COUNT', column as never) as never;
    const col = (name: string) => sequelize.col(name);

    const [schoolRows, userRoleRows, studentRows, busRows, routeRows, tripRows] = await Promise.all(
      [
        this.schools.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.users.findAll({
          attributes: ['role', [count(col('id')), 'count']],
          group: ['role'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.students.findAll({
          attributes: [count(col('id'))],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.buses.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.routes.findAll({
          attributes: ['is_active', [count(col('id')), 'count']],
          group: ['is_active'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
        this.trips.findAll({
          attributes: ['status', [count(col('id')), 'count']],
          group: ['status'],
          raw: true,
        }) as unknown as Promise<GroupCount[]>,
      ],
    );

    let activeSchools = 0;
    let inactiveSchools = 0;
    for (const row of schoolRows) {
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activeSchools += Number(row.count ?? 0);
      } else {
        inactiveSchools += Number(row.count ?? 0);
      }
    }

    let schoolAdmins = 0;
    let drivers = 0;
    let conductors = 0;
    let parents = 0;
    let superAdmins = 0;
    for (const row of userRoleRows) {
      const value = Number(row.count ?? 0);
      switch (row.role) {
        case UserRole.SCHOOL_ADMIN:
          schoolAdmins += value;
          break;
        case UserRole.DRIVER:
          drivers += value;
          break;
        case UserRole.CONDUCTOR:
          conductors += value;
          break;
        case UserRole.PARENT:
          parents += value;
          break;
        case UserRole.SUPER_ADMIN:
          superAdmins += value;
          break;
      }
    }

    const students = Number(studentRows[0]?.count ?? 0);

    let activeBuses = 0;
    let totalBuses = 0;
    for (const row of busRows) {
      const value = Number(row.count ?? 0);
      totalBuses += value;
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activeBuses += value;
      }
    }

    let activeRoutes = 0;
    let totalRoutes = 0;
    for (const row of routeRows) {
      const value = Number(row.count ?? 0);
      totalRoutes += value;
      if (row.is_active === true || row.is_active === 1 || row.is_active === 'true') {
        activeRoutes += value;
      }
    }

    let activeTrips = 0;
    let totalTrips = 0;
    for (const row of tripRows) {
      const value = Number(row.count ?? 0);
      totalTrips += value;
      if (ACTIVE_TRIP_STATUSES.includes(row.status as TripStatus)) {
        activeTrips += value;
      }
    }

    return {
      schools: {
        total: activeSchools + inactiveSchools,
        active: activeSchools,
        inactive: inactiveSchools,
      },
      users: {
        total: schoolAdmins + students + parents + drivers + conductors,
        school_admins: schoolAdmins,
        students,
        parents,
        drivers,
        conductors,
        super_admins: superAdmins,
      },
      transport: {
        buses: totalBuses,
        active_buses: activeBuses,
        routes: totalRoutes,
        active_routes: activeRoutes,
        trips: totalTrips,
        active_trips: activeTrips,
      },
      generated_at: new Date().toISOString(),
    };
  }
}
