import { Op, type WhereOptions } from 'sequelize';
import { ExportDataset } from '@school-bus-tracking/shared-types';
import type { SheetCell } from '../../excel/excel.util';
import {
  activeClause,
  formatBoolean,
  formatDate,
  formatDateTime,
  searchClause,
  text,
  type ExportDefinition,
  type ExportRepositories,
} from '../export.types';

/** Fleet and network datasets: buses, routes, stops and crew rosters. */

export const busesExport: ExportDefinition = {
  dataset: ExportDataset.BUSES,
  label: 'Buses',
  fileBase: 'buses',
  supportedFilters: ['search', 'status'],
  columns: [
    { header: 'Registration Number', width: 22 },
    { header: 'Bus Number', width: 14 },
    { header: 'Capacity', width: 10 },
    { header: 'Assigned Routes', width: 34 },
    { header: 'Active', width: 10 },
    { header: 'Created At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    const where = {
      school_id: schoolId,
      ...activeClause(query.status),
      [Op.and]: searchClause(query.search, ['registration_number', 'bus_number']),
    } as WhereOptions;

    const total = await repositories.buses.count({ where });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const buses = await repositories.buses.findAll({
          where,
          order: [
            ['registration_number', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (buses.length === 0) {
          return [];
        }

        // "Which routes does this bus serve?" is the first question an admin
        // asks of a fleet list, so the export answers it inline.
        const assignments = await repositories.assignments.findAll({
          where: {
            school_id: schoolId,
            bus_id: { [Op.in]: buses.map((bus) => bus.id) },
            is_active: true,
          },
          attributes: ['bus_id', 'route_id'],
        });

        const routes = await repositories.routes.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(assignments.map((item) => item.route_id))] },
          },
          attributes: ['id', 'code'],
        });
        const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));

        const codesByBus = new Map<string, Set<string>>();
        for (const assignment of assignments) {
          if (!assignment.bus_id) continue;
          const code = routeCodeById.get(assignment.route_id);
          if (!code) continue;
          const set = codesByBus.get(assignment.bus_id) ?? new Set<string>();
          set.add(code);
          codesByBus.set(assignment.bus_id, set);
        }

        return buses.map((bus) => [
          bus.registration_number,
          text(bus.bus_number),
          bus.capacity,
          [...(codesByBus.get(bus.id) ?? [])].sort().join(', '),
          formatBoolean(bus.is_active),
          formatDateTime(bus.created_at),
        ]);
      },
    };
  },
};

export const routesExport: ExportDefinition = {
  dataset: ExportDataset.ROUTES,
  label: 'Routes',
  fileBase: 'routes',
  supportedFilters: ['search', 'status'],
  columns: [
    { header: 'Route Code', width: 14 },
    { header: 'Route Name', width: 30 },
    { header: 'Description', width: 40 },
    { header: 'Stops', width: 10 },
    { header: 'Students', width: 10 },
    { header: 'Active', width: 10 },
    { header: 'Created At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    const where = {
      school_id: schoolId,
      ...activeClause(query.status),
      [Op.and]: searchClause(query.search, ['name', 'code']),
    } as WhereOptions;

    const total = await repositories.routes.count({ where });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const routes = await repositories.routes.findAll({
          where,
          order: [
            ['code', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (routes.length === 0) {
          return [];
        }

        const routeIds = routes.map((route) => route.id);
        const stops = await repositories.stops.findAll({
          where: { school_id: schoolId, route_id: { [Op.in]: routeIds } },
          attributes: ['id', 'route_id'],
        });

        const stopCountByRoute = new Map<string, number>();
        const routeByStop = new Map<string, string>();
        for (const stop of stops) {
          stopCountByRoute.set(stop.route_id, (stopCountByRoute.get(stop.route_id) ?? 0) + 1);
          routeByStop.set(stop.id, stop.route_id);
        }

        const students = stops.length
          ? await repositories.students.findAll({
              where: {
                school_id: schoolId,
                home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
                is_active: true,
              },
              attributes: ['home_stop_id'],
            })
          : [];

        const studentCountByRoute = new Map<string, number>();
        for (const student of students) {
          const routeId = student.home_stop_id ? routeByStop.get(student.home_stop_id) : undefined;
          if (!routeId) continue;
          studentCountByRoute.set(routeId, (studentCountByRoute.get(routeId) ?? 0) + 1);
        }

        return routes.map((route) => [
          route.code,
          route.name,
          text(route.description),
          stopCountByRoute.get(route.id) ?? 0,
          studentCountByRoute.get(route.id) ?? 0,
          formatBoolean(route.is_active),
          formatDateTime(route.created_at),
        ]);
      },
    };
  },
};

export const stopsExport: ExportDefinition = {
  dataset: ExportDataset.STOPS,
  label: 'Stops',
  fileBase: 'stops',
  supportedFilters: ['search', 'status', 'route_id'],
  columns: [
    { header: 'Route Code', width: 14 },
    { header: 'Route Name', width: 26 },
    { header: 'Sequence', width: 10 },
    { header: 'Stop Name', width: 30 },
    { header: 'Address', width: 36 },
    { header: 'Latitude', width: 14 },
    { header: 'Longitude', width: 14 },
    { header: 'Geofence Radius (m)', width: 20 },
    { header: 'Estimated Arrival', width: 18 },
    { header: 'Students', width: 10 },
    { header: 'Active', width: 10 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      ...activeClause(query.status),
      [Op.and]: searchClause(query.search, ['name', 'address']),
    };
    if (query.route_id) {
      where.route_id = query.route_id;
    }

    const total = await repositories.stops.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const stops = await repositories.stops.findAll({
          where: where as WhereOptions,
          order: [
            ['route_id', 'ASC'],
            ['sequence_number', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (stops.length === 0) {
          return [];
        }

        const routes = await repositories.routes.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(stops.map((stop) => stop.route_id))] },
          },
          attributes: ['id', 'code', 'name'],
        });
        const routeById = new Map(routes.map((route) => [route.id, route]));

        const students = await repositories.students.findAll({
          where: {
            school_id: schoolId,
            home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
            is_active: true,
          },
          attributes: ['home_stop_id'],
        });
        const countByStop = new Map<string, number>();
        for (const student of students) {
          if (!student.home_stop_id) continue;
          countByStop.set(student.home_stop_id, (countByStop.get(student.home_stop_id) ?? 0) + 1);
        }

        return stops.map((stop) => {
          const route = routeById.get(stop.route_id);
          return [
            text(route?.code),
            text(route?.name),
            stop.sequence_number,
            stop.name,
            text(stop.address),
            text(stop.latitude),
            text(stop.longitude),
            stop.geofence_radius_meters,
            text(stop.estimated_arrival_time),
            countByStop.get(stop.id) ?? 0,
            formatBoolean(stop.is_active),
          ];
        });
      },
    };
  },
};

export const routeAssignmentsExport: ExportDefinition = {
  dataset: ExportDataset.ROUTE_ASSIGNMENTS,
  label: 'Route assignments',
  fileBase: 'route_assignments',
  supportedFilters: ['status', 'route_id', 'bus_id', 'driver_id'],
  columns: [
    { header: 'Route Code', width: 14 },
    { header: 'Route Name', width: 26 },
    { header: 'Role', width: 12 },
    { header: 'Crew Name', width: 26 },
    { header: 'Crew Email', width: 30 },
    { header: 'Crew Phone', width: 18 },
    { header: 'Bus Registration', width: 20 },
    { header: 'Effective From', width: 16 },
    { header: 'Effective To', width: 16 },
    { header: 'Active', width: 10 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      ...activeClause(query.status),
    };
    if (query.route_id) {
      where.route_id = query.route_id;
    }
    if (query.bus_id) {
      where.bus_id = query.bus_id;
    }
    // The list screen sends whichever crew filter it has; both mean `user_id`.
    const crewId = query.driver_id ?? query.conductor_id;
    if (crewId) {
      where.user_id = crewId;
    }

    const total = await repositories.assignments.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const assignments = await repositories.assignments.findAll({
          where: where as WhereOptions,
          order: [
            ['effective_from', 'DESC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (assignments.length === 0) {
          return [];
        }

        const [routes, crew, buses] = await Promise.all([
          repositories.routes.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(assignments.map((item) => item.route_id))] },
            },
            attributes: ['id', 'code', 'name'],
          }),
          repositories.users.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(assignments.map((item) => item.user_id))] },
            },
            attributes: ['id', 'first_name', 'last_name', 'email', 'phone'],
          }),
          repositories.buses.findAll({
            where: {
              school_id: schoolId,
              id: {
                [Op.in]: [
                  ...new Set(
                    assignments
                      .map((item) => item.bus_id)
                      .filter((id): id is string => Boolean(id)),
                  ),
                ],
              },
            },
            attributes: ['id', 'registration_number'],
          }),
        ]);

        const routeById = new Map(routes.map((route) => [route.id, route]));
        const userById = new Map(crew.map((user) => [user.id, user]));
        const busById = new Map(buses.map((bus) => [bus.id, bus]));

        return assignments.map((assignment) => {
          const route = routeById.get(assignment.route_id);
          const user = userById.get(assignment.user_id);
          const bus = assignment.bus_id ? busById.get(assignment.bus_id) : undefined;
          return [
            text(route?.code),
            text(route?.name),
            assignment.role,
            user ? `${user.first_name} ${user.last_name}`.trim() : '',
            text(user?.email),
            text(user?.phone),
            text(bus?.registration_number),
            formatDate(assignment.effective_from),
            formatDate(assignment.effective_to),
            formatBoolean(assignment.is_active),
          ];
        });
      },
    };
  },
};

/** Kept for the operations datasets that need the same helper signature. */
export type { ExportRepositories };
