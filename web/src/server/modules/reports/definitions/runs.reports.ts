import { Op, type WhereOptions } from 'sequelize';
import { ReportType } from '@school-bus-tracking/shared-types';
import {
  card,
  dateRange,
  isoDate,
  paginateRows,
  percentage,
  type ReportDefinition,
  type ReportRepositories,
  type ReportRow,
} from '../report.types';

/**
 * Run-level operations reports (`docs/operating-model.md` §10 Phase 4):
 * run utilisation, bus-day tiering, crew load and deadhead.
 *
 * These read the operating-model tables directly (`runs`, `run_crew`,
 * `shifts`, plus `students.run_id` and `trips.run_id`) — they never touch the
 * retired `route_assignments` mirror.
 */

/** Loads the runs of the tenant with shift/bus/route filters applied. */
async function loadRuns(
  repositories: ReportRepositories,
  schoolId: string,
  query: { route_id?: string; bus_id?: string; shift_id?: string; status?: string },
) {
  const where: Record<string, unknown> = { school_id: schoolId };
  if (query.route_id) where.route_id = query.route_id;
  if (query.bus_id) where.bus_id = query.bus_id;
  if (query.shift_id) where.shift_id = query.shift_id;
  if (query.status === 'active') where.is_active = true;
  if (query.status === 'inactive') where.is_active = false;

  return repositories.runs.findAll({
    where: where as WhereOptions,
    attributes: ['id', 'route_id', 'shift_id', 'bus_id', 'code', 'is_active', 'is_default'],
    order: [['code', 'ASC']],
  });
}

/** Shift label map for the school (`null` shift = whole day, §4.3). */
async function shiftLabels(repositories: ReportRepositories, schoolId: string) {
  const shifts = await repositories.shifts.findAll({
    where: { school_id: schoolId },
    attributes: ['id', 'name', 'start_time', 'end_time'],
  });
  const byId = new Map(shifts.map((shift) => [shift.id, shift.name]));
  return { byId, shifts };
}

/** Count of active riders allocated to each run (`students.run_id`). */
async function ridersByRun(
  repositories: ReportRepositories,
  schoolId: string,
  runIds: string[],
): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const students = await repositories.students.findAll({
    where: {
      school_id: schoolId,
      is_active: true,
      run_id: { [Op.in]: runIds },
    } as WhereOptions,
    attributes: ['run_id'],
  });
  const counts = new Map<string, number>();
  for (const student of students) {
    if (!student.run_id) continue;
    counts.set(student.run_id, (counts.get(student.run_id) ?? 0) + 1);
  }
  return counts;
}

/** Trip count per run over the selected period (`trips.run_id`). */
async function tripsByRun(
  repositories: ReportRepositories,
  schoolId: string,
  runIds: string[],
  dateFrom?: string,
  dateTo?: string,
): Promise<Map<string, number>> {
  if (runIds.length === 0) return new Map();
  const where: Record<string, unknown> = {
    school_id: schoolId,
    run_id: { [Op.in]: runIds },
  };
  const range = dateRange(dateFrom, dateTo);
  if (range) where.scheduled_start_at = range;
  const trips = await repositories.trips.findAll({
    where: where as WhereOptions,
    attributes: ['run_id'],
  });
  const counts = new Map<string, number>();
  for (const trip of trips) {
    if (!trip.run_id) continue;
    counts.set(trip.run_id, (counts.get(trip.run_id) ?? 0) + 1);
  }
  return counts;
}

/** Capacity of each bus (seats), keyed by bus id. */
async function busCapacities(
  repositories: ReportRepositories,
  schoolId: string,
  busIds: string[],
) {
  if (busIds.length === 0) return { byId: new Map<string, number>() };
  const buses = await repositories.buses.findAll({
    where: { school_id: schoolId, id: { [Op.in]: busIds } },
    attributes: ['id', 'capacity', 'registration_number', 'bus_number'],
  });
  return {
    byId: new Map(buses.map((bus) => [bus.id, bus.capacity])),
    buses,
  };
}

/** Route code/name map. */
async function routeLabels(repositories: ReportRepositories, schoolId: string) {
  const routes = await repositories.routes.findAll({
    where: { school_id: schoolId },
    attributes: ['id', 'code', 'name'],
  });
  return new Map(routes.map((route) => [route.id, { code: route.code, name: route.name }]));
}

/**
 * Run utilisation: for every (filtered) run — riders, bus capacity, fill %,
 * trips in the period and crew completeness. The operating-model analogue of
 * the legacy fleet-utilisation report, keyed on the vehicle pass, not the
 * route.
 */
export const runUtilizationReport: ReportDefinition = {
  report: ReportType.RUN_UTILIZATION,
  label: 'Run utilisation',
  description: 'Riders, seats and trips for each timed run over the period.',
  category: 'transport',
  filters: ['route_id', 'bus_id', 'shift_id', 'status', 'date_from', 'date_to'],
  fileBase: 'run_utilization',
  columns: [
    { key: 'run_code', label: 'Run code', type: 'text' },
    { key: 'route', label: 'Route', type: 'text' },
    { key: 'shift', label: 'Shift', type: 'text' },
    { key: 'bus', label: 'Bus', type: 'text' },
    { key: 'riders', label: 'Riders', type: 'number' },
    { key: 'capacity', label: 'Seats', type: 'number' },
    { key: 'fill', label: 'Fill %', type: 'number' },
    { key: 'trips', label: 'Trips in period', type: 'number' },
    { key: 'crew', label: 'Crew', type: 'text' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const runs = await loadRuns(repositories, schoolId, query);
    if (runs.length === 0) {
      return { summary: [], rows: [], total: 0 };
    }

    const runIds = runs.map((run) => run.id);
    const busIds = [...new Set(runs.map((run) => run.bus_id).filter((id): id is string => Boolean(id)))];
    const [{ byId: capacityById }, riders, trips, { byId: shiftById }, routes, crew] =
      await Promise.all([
        busCapacities(repositories, schoolId, busIds),
        ridersByRun(repositories, schoolId, runIds),
        tripsByRun(repositories, schoolId, runIds, query.date_from, query.date_to),
        shiftLabels(repositories, schoolId),
        routeLabels(repositories, schoolId),
        crewByRun(repositories, schoolId, runIds),
      ]);

    const rows: ReportRow[] = runs.map((run) => {
      const route = routes.get(run.route_id);
      const riderCount = riders.get(run.id) ?? 0;
      const capacity = run.bus_id ? (capacityById.get(run.bus_id) ?? 0) : 0;
      const crewState = crew.get(run.id);
      return {
        run_code: run.code,
        route: route ? `${route.code} — ${route.name}` : '—',
        shift: run.shift_id ? (shiftById.get(run.shift_id) ?? '—') : 'Whole day (legacy)',
        bus: run.bus_id ? 'Rostered' : 'No bus',
        riders: riderCount,
        capacity,
        fill: percentage(riderCount, capacity),
        trips: trips.get(run.id) ?? 0,
        crew:
          crewState?.driver && crewState?.conductor
            ? 'Driver + conductor'
            : crewState?.driver
              ? 'Driver only'
              : crewState?.conductor
                ? 'Conductor only'
                : 'Uncrewed',
        active: run.is_active ? 'Yes' : 'No',
      };
    });

    const totalRiders = rows.reduce((sum, row) => sum + Number(row.riders), 0);
    const totalSeats = rows.reduce((sum, row) => sum + Number(row.capacity), 0);
    const uncrewed = rows.filter((row) => row.crew === 'Uncrewed').length;

    return {
      summary: [
        card('runs', 'Runs', rows.length),
        card('riders', 'Allocated riders', totalRiders),
        card('fill', 'Average fill %', percentage(totalRiders, totalSeats)),
        card('uncrewed', 'Uncrewed runs', uncrewed, uncrewed > 0 ? 'Runs with no active roster' : null),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/**
 * Bus-day tiering: how many distinct shift windows each bus covers across the
 * runs rostered on it. A bus on two disjoint shifts (Morning + Afternoon) is
 * tier 2 — the legal configuration the window-based conflict engine exists to
 * enable. The report counts distinct *shifts* rather than runs, so two runs in
 * one window do not overstate tiering.
 */
export const busDayTieringReport: ReportDefinition = {
  report: ReportType.BUS_DAY_TIERING,
  label: 'Bus day tiering',
  description: 'How many shift windows each bus covers — the tiering story.',
  category: 'transport',
  filters: ['bus_id', 'shift_id', 'status', 'date_from', 'date_to'],
  fileBase: 'bus_day_tiering',
  columns: [
    { key: 'registration_number', label: 'Registration', type: 'text' },
    { key: 'bus_number', label: 'Bus number', type: 'text' },
    { key: 'runs', label: 'Runs', type: 'number' },
    { key: 'shifts', label: 'Shift windows', type: 'number' },
    { key: 'tiers', label: 'Tier', type: 'number' },
    { key: 'trips', label: 'Trips in period', type: 'number' },
    { key: 'capacity', label: 'Capacity', type: 'number' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const where: Record<string, unknown> = { school_id: schoolId, is_active: true };
    if (query.bus_id) where.id = query.bus_id;
    if (query.status === 'active') where.is_active = true;
    if (query.status === 'inactive') where.is_active = false;
    const buses = await repositories.buses.findAll({
      where: where as WhereOptions,
      order: [['registration_number', 'ASC']],
    });
    if (buses.length === 0) {
      return { summary: [], rows: [], total: 0 };
    }

    const busIds = buses.map((bus) => bus.id);
    const runWhere: Record<string, unknown> = {
      school_id: schoolId,
      bus_id: { [Op.in]: busIds },
    };
    if (query.shift_id) runWhere.shift_id = query.shift_id;
    const runs = await repositories.runs.findAll({
      where: runWhere as WhereOptions,
      attributes: ['id', 'bus_id', 'shift_id', 'is_active'],
    });

    const runsByBus = new Map<string, typeof runs>();
    for (const run of runs) {
      if (!run.bus_id) continue;
      const set = runsByBus.get(run.bus_id) ?? [];
      set.push(run);
      runsByBus.set(run.bus_id, set);
    }

    const allRunIds = runs.map((run) => run.id);
    const trips = await tripsByRun(repositories, schoolId, allRunIds, query.date_from, query.date_to);

    const rows: ReportRow[] = buses.map((bus) => {
      const busRuns = runsByBus.get(bus.id) ?? [];
      const activeRuns = busRuns.filter((run) => run.is_active);
      // Distinct shift windows; NULL shifts each count as their own whole-day
      // window (they conflict with everything, §4.3) so they are not merged.
      const distinctShifts = new Set(
        activeRuns.map((run) => (run.shift_id ? `shift:${run.shift_id}` : `whole:${run.id}`)),
      );
      const tier = distinctShifts.size;
      const tripCount = activeRuns.reduce((sum, run) => sum + (trips.get(run.id) ?? 0), 0);
      return {
        registration_number: bus.registration_number,
        bus_number: bus.bus_number ?? '',
        runs: activeRuns.length,
        shifts: tier,
        tiers: tier,
        trips: tripCount,
        capacity: bus.capacity,
        active: bus.is_active ? 'Yes' : 'No',
      };
    });

    const tiered = rows.filter((row) => Number(row.tiers) >= 2).length;
    const idle = rows.filter((row) => Number(row.runs) === 0).length;

    return {
      summary: [
        card('buses', 'Buses', rows.length),
        card('tiered', 'Tiered (2+ windows)', tiered, tiered > 0 ? 'Buses covering disjoint shifts' : null),
        card('idle', 'Not rostered', idle),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/**
 * Crew load: for each active driver/conductor, the number of runs they are
 * rostered on and the distinct shift windows those runs span. Lets an
 * operator see who is over- or under-utilised and prove the tiering is legal
 * (a person may hold runs only in disjoint windows).
 */
export const crewLoadReport: ReportDefinition = {
  report: ReportType.CREW_LOAD,
  label: 'Crew load',
  description: 'Runs and shift windows rostered per driver and conductor.',
  category: 'transport',
  filters: ['driver_id', 'shift_id', 'status', 'date_from', 'date_to'],
  fileBase: 'crew_load',
  columns: [
    { key: 'name', label: 'Crew member', type: 'text' },
    { key: 'role', label: 'Role', type: 'text' },
    { key: 'runs', label: 'Runs', type: 'number' },
    { key: 'shifts', label: 'Shift windows', type: 'number' },
    { key: 'window', label: 'Windows', type: 'text' },
    { key: 'effective_from', label: 'Rostered from', type: 'date' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    // Today's roster: active rows whose effective window covers the report
    // date (or open). The report is "current load", not historical.
    const today = isoDate(new Date());
    const crewWhere: Record<string, unknown> = {
      school_id: schoolId,
      is_active: true,
      effective_from: { [Op.lte]: today },
      [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: today } }],
    };
    if (query.driver_id) crewWhere.user_id = query.driver_id;
    const roster = await repositories.runCrew.findAll({
      where: crewWhere as WhereOptions,
      attributes: ['id', 'run_id', 'user_id', 'role', 'effective_from', 'effective_to'],
    });
    if (roster.length === 0) {
      return { summary: [], rows: [], total: 0 };
    }

    const runIds = [...new Set(roster.map((row) => row.run_id))];
    const [runs, users] = await Promise.all([
      repositories.runs.findAll({
        where: { school_id: schoolId, id: { [Op.in]: runIds } },
        attributes: ['id', 'shift_id', 'is_active'],
      }),
      repositories.users.findAll({
        where: { school_id: schoolId, id: { [Op.in]: [...new Set(roster.map((row) => row.user_id))] } },
        attributes: ['id', 'first_name', 'last_name', 'is_active', 'role'],
      }),
    ]);
    const { byId: shiftById } = await shiftLabels(repositories, schoolId);

    const runById = new Map(runs.map((run) => [run.id, run]));
    const userById = new Map(users.map((user) => [user.id, user]));

    // One row per person + role, aggregating the runs they are on.
    const aggregated = new Map<string, ReportRow>();
    for (const row of roster) {
      const run = runById.get(row.run_id);
      if (!run) continue;
      if (query.shift_id && run.shift_id !== query.shift_id) continue;
      const user = userById.get(row.user_id);
      const key = `${row.user_id}:${row.role}`;
      const existing = aggregated.get(key);
      const windowLabel = run.shift_id ? (shiftById.get(run.shift_id) ?? '—') : 'Whole day';
      if (existing) {
        const runs = Number(existing.runs) + 1;
        const windows = new Set(String(existing.window).split('|').filter(Boolean));
        windows.add(windowLabel);
        existing.runs = runs;
        existing.shifts = windows.size;
        existing.window = [...windows].join('|');
      } else {
        aggregated.set(key, {
          name: user ? `${user.first_name} ${user.last_name}`.trim() : '—',
          role: row.role === 'DRIVER' ? 'Driver' : 'Conductor',
          runs: 1,
          shifts: 1,
          window: windowLabel,
          effective_from: isoDate(row.effective_from),
          active: user?.is_active === false ? 'No' : 'Yes',
        });
      }
    }

    const rows = [...aggregated.values()].sort((a, b) => Number(b.runs) - Number(a.runs));
    const overloaded = rows.filter((row) => Number(row.shifts) > 1 && String(row.window).includes('Whole day')).length;

    return {
      summary: [
        card('crew', 'Crew rostered', rows.length),
        card('assignments', 'Active roster rows', rows.reduce((s, r) => s + Number(r.runs), 0)),
        card('multi', 'On 2+ windows', rows.filter((r) => Number(r.shifts) >= 2).length),
        card(
          'whole_day',
          'Holding a whole-day run',
          overloaded,
          overloaded > 0 ? 'These block tiering for that person' : null,
        ),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/**
 * Deadhead runs: active runs with a bus rostered but zero allocated riders
 * (and no trips in the period). Dead service is a run planned or driven
 * without anyone on the manifest — the first thing to cut when right-sizing
 * the fleet.
 */
export const deadheadRunsReport: ReportDefinition = {
  report: ReportType.DEADHEAD_RUNS,
  label: 'Deadhead runs',
  description: 'Active runs with a bus but no allocated riders or trips.',
  category: 'transport',
  filters: ['route_id', 'bus_id', 'shift_id', 'status', 'date_from', 'date_to'],
  fileBase: 'deadhead_runs',
  columns: [
    { key: 'run_code', label: 'Run code', type: 'text' },
    { key: 'route', label: 'Route', type: 'text' },
    { key: 'shift', label: 'Shift', type: 'text' },
    { key: 'bus', label: 'Bus', type: 'text' },
    { key: 'riders', label: 'Riders', type: 'number' },
    { key: 'trips', label: 'Trips in period', type: 'number' },
    { key: 'reason', label: 'Flag', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const runs = await loadRuns(repositories, schoolId, query);
    if (runs.length === 0) {
      return { summary: [], rows: [], total: 0 };
    }

    const runIds = runs.map((run) => run.id);
    const [riders, trips, { byId: shiftById }, routes] = await Promise.all([
      ridersByRun(repositories, schoolId, runIds),
      tripsByRun(repositories, schoolId, runIds, query.date_from, query.date_to),
      shiftLabels(repositories, schoolId),
      routeLabels(repositories, schoolId),
    ]);

    // A run matters for deadhead when a bus is assigned but it carries
    // nobody. Runs without a bus are undecided fleet, not dead service.
    const rows: ReportRow[] = runs
      .filter((run) => run.is_active && run.bus_id)
      .map((run) => {
        const route = routes.get(run.route_id);
        const riderCount = riders.get(run.id) ?? 0;
        const tripCount = trips.get(run.id) ?? 0;
        return {
          run_code: run.code,
          route: route ? `${route.code} — ${route.name}` : '—',
          shift: run.shift_id ? (shiftById.get(run.shift_id) ?? '—') : 'Whole day (legacy)',
          bus: 'Rostered',
          riders: riderCount,
          trips: tripCount,
          reason:
            riderCount === 0 && tripCount === 0
              ? 'Dead (no riders, no trips)'
              : riderCount === 0
                ? 'No riders allocated'
                : '',
        };
      })
      .filter((row) => Number(row.riders) === 0);

    const noTrips = rows.filter((row) => Number(row.trips) === 0).length;

    return {
      summary: [
        card('dead', 'Dead runs', rows.length, rows.length ? 'Bus on, manifest empty' : null),
        card('no_trips', 'Never operated in period', noTrips),
        card('active_runs', 'Active runs total', runs.filter((run) => run.is_active).length),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/** Active crew (driver/conductor presence) keyed by run, as of today. */
async function crewByRun(
  repositories: ReportRepositories,
  schoolId: string,
  runIds: string[],
): Promise<Map<string, { driver: boolean; conductor: boolean }>> {
  const result = new Map<string, { driver: boolean; conductor: boolean }>();
  if (runIds.length === 0) return result;
  const today = isoDate(new Date());
  const roster = await repositories.runCrew.findAll({
    where: {
      school_id: schoolId,
      is_active: true,
      run_id: { [Op.in]: runIds },
      effective_from: { [Op.lte]: today },
      [Op.or]: [{ effective_to: null }, { effective_to: { [Op.gte]: today } }],
    } as WhereOptions,
    attributes: ['run_id', 'role'],
  });
  for (const row of roster) {
    const entry = result.get(row.run_id) ?? { driver: false, conductor: false };
    if (row.role === 'DRIVER') entry.driver = true;
    if (row.role === 'CONDUCTOR') entry.conductor = true;
    result.set(row.run_id, entry);
  }
  return result;
}
