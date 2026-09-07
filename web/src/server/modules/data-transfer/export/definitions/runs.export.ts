import { Op, type WhereOptions } from 'sequelize';
import { ExportDataset } from '@school-bus-tracking/shared-types';
import type { SheetCell } from '../../excel/excel.util';
import {
  activeClause,
  formatBoolean,
  formatDateTime,
  searchClause,
  text,
  type ExportDefinition,
} from '../export.types';

/**
 * Operating-model datasets: shifts (bell windows) and runs (timed vehicle
 * passes). These are the export counterparts of the Phase 4 reports and of
 * the /shifts screen — they read `shifts` / `runs` / `run_crew` directly, not
 * the retired route-assignment mirror.
 */

/** Bell windows: name, wall-clock window and how many live runs use them. */
export const shiftsExport: ExportDefinition = {
  dataset: ExportDataset.SHIFTS,
  label: 'Shifts',
  fileBase: 'shifts',
  supportedFilters: ['search', 'status'],
  columns: [
    { header: 'Shift Name', width: 22 },
    { header: 'Start Time', width: 12 },
    { header: 'End Time', width: 12 },
    { header: 'Runs', width: 8 },
    { header: 'Active', width: 10 },
    { header: 'Created At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    const where = {
      school_id: schoolId,
      ...activeClause(query.status),
      [Op.and]: searchClause(query.search, ['name']),
    } as WhereOptions;

    const total = await repositories.shifts.count({ where });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const shifts = await repositories.shifts.findAll({
          where,
          order: [
            ['start_time', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (shifts.length === 0) {
          return [];
        }

        const runs = await repositories.runs.findAll({
          where: {
            school_id: schoolId,
            shift_id: { [Op.in]: shifts.map((shift) => shift.id) },
            is_active: true,
          },
          attributes: ['shift_id'],
        });
        const runsByShift = new Map<string, number>();
        for (const run of runs) {
          if (!run.shift_id) continue;
          runsByShift.set(run.shift_id, (runsByShift.get(run.shift_id) ?? 0) + 1);
        }

        return shifts.map((shift) => [
          shift.name,
          text(shift.start_time),
          text(shift.end_time),
          runsByShift.get(shift.id) ?? 0,
          formatBoolean(shift.is_active),
          formatDateTime(shift.created_at),
        ]);
      },
    };
  },
};

/** Timed vehicle passes: code, route, bell window, vehicle and crew roster. */
export const runsExport: ExportDefinition = {
  dataset: ExportDataset.RUNS,
  label: 'Runs',
  fileBase: 'runs',
  supportedFilters: ['search', 'status', 'route_id', 'bus_id', 'driver_id'],
  columns: [
    { header: 'Run Code', width: 14 },
    { header: 'Route Code', width: 14 },
    { header: 'Route Name', width: 26 },
    { header: 'Shift', width: 16 },
    { header: 'Shift Window', width: 18 },
    { header: 'Bus Registration', width: 20 },
    { header: 'Driver', width: 26 },
    { header: 'Conductor', width: 26 },
    { header: 'Riders', width: 8 },
    { header: 'Default', width: 10 },
    { header: 'Active', width: 10 },
    { header: 'Created At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      ...activeClause(query.status),
      [Op.and]: searchClause(query.search, ['code']),
    };
    if (query.route_id) where.route_id = query.route_id;
    if (query.bus_id) where.bus_id = query.bus_id;

    // A driver/conductor filter resolves the runs that person is rostered on
    // (run crew pins `user_id`; runs pin `bus_id`/`route_id`). An empty match
    // yields an empty id list, so the page query returns nothing.
    const crewRunIds = query.driver_id
      ? (
          await repositories.runCrew.findAll({
            where: { school_id: schoolId, user_id: query.driver_id, is_active: true },
            attributes: ['run_id'],
          })
        ).map((row) => row.run_id)
      : null;

    const countWhere: WhereOptions = crewRunIds
      ? ({
          school_id: schoolId,
          ...activeClause(query.status),
          id: { [Op.in]: crewRunIds },
        } as WhereOptions)
      : (where as WhereOptions);
    const total = await repositories.runs.count({ where: countWhere });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const pageWhere: Record<string, unknown> = crewRunIds
          ? {
              school_id: schoolId,
              ...activeClause(query.status),
              id: { [Op.in]: crewRunIds },
            }
          : where;

        const runRows = await repositories.runs.findAll({
          where: pageWhere as WhereOptions,
          order: [
            ['code', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (runRows.length === 0) {
          return [];
        }

        const runIds = runRows.map((run) => run.id);
        const [routes, shifts, buses, crew, riders] = await Promise.all([
          repositories.routes.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(runRows.map((run) => run.route_id))] },
            },
            attributes: ['id', 'code', 'name'],
          }),
          repositories.shifts.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: runRows.map((run) => run.shift_id).filter((id): id is string => Boolean(id)) },
            },
            attributes: ['id', 'name', 'start_time', 'end_time'],
          }),
          repositories.buses.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: runRows.map((run) => run.bus_id).filter((id): id is string => Boolean(id)) },
            },
            attributes: ['id', 'registration_number'],
          }),
          repositories.runCrew.findAll({
            where: { school_id: schoolId, run_id: { [Op.in]: runIds }, is_active: true },
            attributes: ['run_id', 'user_id', 'role'],
          }),
          repositories.students.findAll({
            where: { school_id: schoolId, run_id: { [Op.in]: runIds }, is_active: true },
            attributes: ['run_id'],
          }),
        ]);

        const routeById = new Map(routes.map((route) => [route.id, route]));
        const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
        const busById = new Map(buses.map((bus) => [bus.id, bus]));

        const crewUserIds = [...new Set(crew.map((row) => row.user_id))];
        const users = crewUserIds.length
          ? await repositories.users.findAll({
              where: { school_id: schoolId, id: { [Op.in]: crewUserIds } },
              attributes: ['id', 'first_name', 'last_name'],
            })
          : [];
        const userById = new Map(users.map((user) => [user.id, user]));
        const nameOf = (userId: string | undefined) => {
          if (!userId) return '';
          const user = userById.get(userId);
          return user ? `${user.first_name} ${user.last_name}`.trim() : '';
        };

        const driverByRun = new Map<string, string>();
        const conductorByRun = new Map<string, string>();
        for (const row of crew) {
          if (row.role === 'DRIVER') driverByRun.set(row.run_id, row.user_id);
          if (row.role === 'CONDUCTOR') conductorByRun.set(row.run_id, row.user_id);
        }

        const ridersByRun = new Map<string, number>();
        for (const student of riders) {
          if (!student.run_id) continue;
          ridersByRun.set(student.run_id, (ridersByRun.get(student.run_id) ?? 0) + 1);
        }

        return runRows.map((run) => {
          const route = routeById.get(run.route_id);
          const shift = run.shift_id ? shiftById.get(run.shift_id) : undefined;
          const bus = run.bus_id ? busById.get(run.bus_id) : undefined;
          return [
            run.code,
            text(route?.code),
            text(route?.name),
            shift ? shift.name : 'Whole day (legacy)',
            shift ? `${text(shift.start_time)}–${text(shift.end_time)}` : '',
            text(bus?.registration_number),
            nameOf(driverByRun.get(run.id)),
            nameOf(conductorByRun.get(run.id)),
            ridersByRun.get(run.id) ?? 0,
            formatBoolean(run.is_default),
            formatBoolean(run.is_active),
            formatDateTime(run.created_at),
          ];
        });
      },
    };
  },
};
