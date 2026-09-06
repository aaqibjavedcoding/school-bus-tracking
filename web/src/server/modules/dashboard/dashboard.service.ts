import { DashboardStatsResponse, TripStatus } from '@school-bus-tracking/shared-types';
import { Op } from 'sequelize';

import { Bus, Route, Student, Trip } from '../../database/models';

/** Ranked no more — the dashboard's "Live trips" card counts exactly these. */
const LIVE_TRIP_STATUSES: TripStatus[] = [TripStatus.BOARDING, TripStatus.IN_PROGRESS];

/** Inclusive window covering the current UTC calendar day. */
function todayRange(): Record<symbol, Date> {
  const start = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`);
  return { [Op.gte]: start, [Op.lt]: new Date(start.getTime() + 86_400_000) };
}

/**
 * School-admin operations dashboard statistics.
 *
 * The dashboard's four stat cards need exactly four numbers. Fetching them
 * through the enriched list endpoints (`listStudents({ limit: 1 })` and
 * friends) used to cost ~28 queries because every list projection resolves
 * crew, buses, stops and trips the cards never render. This service answers
 * the same cards with four parallel `COUNT(*)` queries and nothing else.
 *
 * Trip data for the "Today's trips" table still comes from `listTrips` —
 * only the headline counts live here.
 */
export class DashboardService {
  constructor(
    private readonly students: typeof Student,
    private readonly buses: typeof Bus,
    private readonly routes: typeof Route,
    private readonly trips: typeof Trip,
  ) {}

  /**
   * Headline counts in one round trip: students, buses, routes and today's
   * live (boarding / in-progress) trips — four tenant-pinned COUNT queries
   * run in parallel, zero enrichment.
   */
  async stats(schoolId: string): Promise<DashboardStatsResponse> {
    const [students, buses, routes, activeTrips] = await Promise.all([
      this.students.count({ where: { school_id: schoolId } }),
      this.buses.count({ where: { school_id: schoolId } }),
      this.routes.count({ where: { school_id: schoolId } }),
      this.trips.count({
        where: {
          school_id: schoolId,
          status: { [Op.in]: LIVE_TRIP_STATUSES },
          scheduled_start_at: todayRange(),
        },
      }),
    ]);

    return {
      students,
      buses,
      routes,
      active_trips: activeTrips,
      generated_at: new Date().toISOString(),
    };
  }
}
