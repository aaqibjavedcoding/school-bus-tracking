import { Op, type WhereOptions } from 'sequelize';
import { ReportType, RouteAssignmentRole } from '@school-bus-tracking/shared-types';
import {
  card,
  escapeLikePattern,
  isoDate,
  paginateRows,
  percentage,
  type ReportDefinition,
  type ReportRepositories,
  type ReportRow,
} from '../report.types';

/**
 * Student-side reports: where pupils are allocated and who is not allocated at
 * all.
 *
 * Every figure is computed from `students.home_stop_id` → `stops.route_id`,
 * which is the only allocation the domain model actually stores. There is no
 * separate "student ↔ route" table, so a report that claimed to know a pupil's
 * route independently of their stop would be inventing data.
 */

/** Students grouped by the route their home stop belongs to. */
export const studentsByRouteReport: ReportDefinition = {
  report: ReportType.STUDENTS_BY_ROUTE,
  label: 'Students by route',
  description: 'How many pupils are allocated to each route, and how full it is.',
  category: 'students',
  filters: ['route_id', 'status'],
  fileBase: 'students_by_route',
  columns: [
    { key: 'route_code', label: 'Route code', type: 'text' },
    { key: 'route_name', label: 'Route', type: 'text' },
    { key: 'stops', label: 'Stops', type: 'number' },
    { key: 'students', label: 'Students', type: 'number' },
    { key: 'capacity', label: 'Assigned seats', type: 'number' },
    { key: 'utilisation', label: 'Utilisation %', type: 'number' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const routeWhere: Record<string, unknown> = { school_id: schoolId };
    if (query.route_id) {
      routeWhere.id = query.route_id;
    }
    if (query.status === 'active') routeWhere.is_active = true;
    if (query.status === 'inactive') routeWhere.is_active = false;

    const routes = await repositories.routes.findAll({
      where: routeWhere as WhereOptions,
      order: [['code', 'ASC']],
    });

    const routeIds = routes.map((route) => route.id);
    const stops = routeIds.length
      ? await repositories.stops.findAll({
          where: { school_id: schoolId, route_id: { [Op.in]: routeIds } },
          attributes: ['id', 'route_id'],
        })
      : [];

    const routeByStop = new Map(stops.map((stop) => [stop.id, stop.route_id]));
    const stopCount = new Map<string, number>();
    for (const stop of stops) {
      stopCount.set(stop.route_id, (stopCount.get(stop.route_id) ?? 0) + 1);
    }

    const students = stops.length
      ? await repositories.students.findAll({
          where: {
            school_id: schoolId,
            is_active: true,
            home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
          },
          attributes: ['home_stop_id'],
        })
      : [];

    const studentCount = new Map<string, number>();
    for (const student of students) {
      const routeId = student.home_stop_id ? routeByStop.get(student.home_stop_id) : undefined;
      if (!routeId) continue;
      studentCount.set(routeId, (studentCount.get(routeId) ?? 0) + 1);
    }

    // Seats available on a route = capacity of the buses currently rostered on
    // it. A route with no bus shows 0, which is exactly the signal an admin
    // wants to see.
    const seats = await seatsByRoute(repositories, schoolId, routeIds);

    const rows: ReportRow[] = routes.map((route) => {
      const students = studentCount.get(route.id) ?? 0;
      const capacity = seats.get(route.id) ?? 0;
      return {
        route_code: route.code,
        route_name: route.name,
        stops: stopCount.get(route.id) ?? 0,
        students,
        capacity,
        utilisation: percentage(students, capacity),
        active: route.is_active ? 'Yes' : 'No',
      };
    });

    const totalStudents = rows.reduce((sum, row) => sum + Number(row.students), 0);
    const totalSeats = rows.reduce((sum, row) => sum + Number(row.capacity), 0);

    return {
      summary: [
        card('routes', 'Routes', rows.length),
        card('students', 'Allocated students', totalStudents),
        card('seats', 'Assigned seats', totalSeats),
        card(
          'utilisation',
          'Fleet utilisation',
          percentage(totalStudents, totalSeats),
          totalSeats > 0 ? `${totalStudents} of ${totalSeats} seats` : 'No buses rostered',
        ),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/** Students grouped by the bus rostered on their route. */
export const studentsByBusReport: ReportDefinition = {
  report: ReportType.STUDENTS_BY_BUS,
  label: 'Students by bus',
  description: 'Pupil load per vehicle, based on the buses currently rostered on each route.',
  category: 'transport',
  filters: ['bus_id', 'status'],
  fileBase: 'students_by_bus',
  columns: [
    { key: 'registration_number', label: 'Registration', type: 'text' },
    { key: 'bus_number', label: 'Bus number', type: 'text' },
    { key: 'capacity', label: 'Capacity', type: 'number' },
    { key: 'routes', label: 'Routes', type: 'text' },
    { key: 'students', label: 'Students', type: 'number' },
    { key: 'utilisation', label: 'Utilisation %', type: 'number' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const busWhere: Record<string, unknown> = { school_id: schoolId };
    if (query.bus_id) {
      busWhere.id = query.bus_id;
    }
    if (query.status === 'active') busWhere.is_active = true;
    if (query.status === 'inactive') busWhere.is_active = false;

    const buses = await repositories.buses.findAll({
      where: busWhere as WhereOptions,
      order: [['registration_number', 'ASC']],
    });
    if (buses.length === 0) {
      return { summary: emptyBusSummary(), rows: [], total: 0 };
    }

    const assignments = await repositories.assignments.findAll({
      where: {
        school_id: schoolId,
        bus_id: { [Op.in]: buses.map((bus) => bus.id) },
        is_active: true,
      },
      attributes: ['bus_id', 'route_id'],
    });

    const routeIdsByBus = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      if (!assignment.bus_id) continue;
      const set = routeIdsByBus.get(assignment.bus_id) ?? new Set<string>();
      set.add(assignment.route_id);
      routeIdsByBus.set(assignment.bus_id, set);
    }

    const allRouteIds = [...new Set(assignments.map((item) => item.route_id))];
    const [routes, stops] = await Promise.all([
      allRouteIds.length
        ? repositories.routes.findAll({
            where: { school_id: schoolId, id: { [Op.in]: allRouteIds } },
            attributes: ['id', 'code'],
          })
        : Promise.resolve([]),
      allRouteIds.length
        ? repositories.stops.findAll({
            where: { school_id: schoolId, route_id: { [Op.in]: allRouteIds } },
            attributes: ['id', 'route_id'],
          })
        : Promise.resolve([]),
    ]);

    const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));
    const students = stops.length
      ? await repositories.students.findAll({
          where: {
            school_id: schoolId,
            is_active: true,
            home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
          },
          attributes: ['home_stop_id'],
        })
      : [];

    const routeByStop = new Map(stops.map((stop) => [stop.id, stop.route_id]));
    const studentsByRoute = new Map<string, number>();
    for (const student of students) {
      const routeId = student.home_stop_id ? routeByStop.get(student.home_stop_id) : undefined;
      if (!routeId) continue;
      studentsByRoute.set(routeId, (studentsByRoute.get(routeId) ?? 0) + 1);
    }

    const rows: ReportRow[] = buses.map((bus) => {
      const routeIds = [...(routeIdsByBus.get(bus.id) ?? [])];
      const students = routeIds.reduce(
        (sum, routeId) => sum + (studentsByRoute.get(routeId) ?? 0),
        0,
      );
      return {
        registration_number: bus.registration_number,
        bus_number: bus.bus_number ?? '',
        capacity: bus.capacity,
        routes: routeIds
          .map((routeId) => routeCodeById.get(routeId) ?? '')
          .filter(Boolean)
          .sort()
          .join(', '),
        students,
        utilisation: percentage(students, bus.capacity),
        active: bus.is_active ? 'Yes' : 'No',
      };
    });

    const totalStudents = rows.reduce((sum, row) => sum + Number(row.students), 0);
    const totalCapacity = rows.reduce((sum, row) => sum + Number(row.capacity), 0);
    const overloaded = rows.filter((row) => Number(row.students) > Number(row.capacity)).length;

    return {
      summary: [
        card('buses', 'Buses', rows.length),
        card('students', 'Students carried', totalStudents),
        card('capacity', 'Total capacity', totalCapacity),
        card(
          'overloaded',
          'Over capacity',
          overloaded,
          overloaded > 0 ? 'Routes need another vehicle' : 'Every bus is within capacity',
        ),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/** Students grouped by boarding point. */
export const studentsByStopReport: ReportDefinition = {
  report: ReportType.STUDENTS_BY_STOP,
  label: 'Students by stop',
  description: 'Pupils waiting at each boarding point, in route order.',
  category: 'students',
  filters: ['route_id', 'stop_id'],
  fileBase: 'students_by_stop',
  columns: [
    { key: 'route_code', label: 'Route code', type: 'text' },
    { key: 'sequence', label: 'Sequence', type: 'number' },
    { key: 'stop_name', label: 'Stop', type: 'text' },
    { key: 'estimated_arrival', label: 'Estimated arrival', type: 'text' },
    { key: 'students', label: 'Students', type: 'number' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const stopWhere: Record<string, unknown> = { school_id: schoolId };
    if (query.route_id) {
      stopWhere.route_id = query.route_id;
    }
    if (query.stop_id) {
      stopWhere.id = query.stop_id;
    }

    const stops = await repositories.stops.findAll({
      where: stopWhere as WhereOptions,
      order: [
        ['route_id', 'ASC'],
        ['sequence_number', 'ASC'],
      ],
    });
    if (stops.length === 0) {
      return {
        summary: [card('stops', 'Stops', 0), card('students', 'Students', 0)],
        rows: [],
        total: 0,
      };
    }

    const [routes, students] = await Promise.all([
      repositories.routes.findAll({
        where: {
          school_id: schoolId,
          id: { [Op.in]: [...new Set(stops.map((stop) => stop.route_id))] },
        },
        attributes: ['id', 'code'],
      }),
      repositories.students.findAll({
        where: {
          school_id: schoolId,
          is_active: true,
          home_stop_id: { [Op.in]: stops.map((stop) => stop.id) },
        },
        attributes: ['home_stop_id'],
      }),
    ]);

    const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));
    const countByStop = new Map<string, number>();
    for (const student of students) {
      if (!student.home_stop_id) continue;
      countByStop.set(student.home_stop_id, (countByStop.get(student.home_stop_id) ?? 0) + 1);
    }

    const rows: ReportRow[] = stops.map((stop) => ({
      route_code: routeCodeById.get(stop.route_id) ?? '',
      sequence: stop.sequence_number,
      stop_name: stop.name,
      estimated_arrival: stop.estimated_arrival_time ?? '',
      students: countByStop.get(stop.id) ?? 0,
      active: stop.is_active ? 'Yes' : 'No',
    }));

    const empty = rows.filter((row) => Number(row.students) === 0).length;

    return {
      summary: [
        card('stops', 'Stops', rows.length),
        card('students', 'Students allocated', students.length),
        card(
          'empty',
          'Stops with no pupils',
          empty,
          empty > 0 ? 'Consider removing them from the route' : null,
        ),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/** Pupils with no transport allocation — the list an admin has to act on. */
export const studentsUnassignedReport: ReportDefinition = {
  report: ReportType.STUDENTS_UNASSIGNED,
  label: 'Students without transport',
  description: 'Active pupils who have no home stop, and therefore no route or bus.',
  category: 'students',
  filters: ['search'],
  fileBase: 'students_without_transport',
  columns: [
    { key: 'admission_number', label: 'Admission number', type: 'text' },
    { key: 'name', label: 'Student', type: 'text' },
    { key: 'grade_level', label: 'Grade', type: 'text' },
    { key: 'guardian', label: 'Primary guardian', type: 'text' },
    { key: 'guardian_phone', label: 'Guardian phone', type: 'text' },
    { key: 'created_at', label: 'Enrolled', type: 'date' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      is_active: true,
      home_stop_id: null,
    };
    if (query.search) {
      const pattern = `%${escapeLikePattern(query.search)}%`;
      where[Op.or as unknown as string] = [
        { first_name: { [Op.iLike]: pattern } },
        { last_name: { [Op.iLike]: pattern } },
        { admission_number: { [Op.iLike]: pattern } },
      ];
    }

    const { rows: students, count } = await repositories.students.findAndCountAll({
      where: where as WhereOptions,
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
      ],
      offset: pagination.offset,
      limit: pagination.limit,
    });

    const totalActive = await repositories.students.count({
      where: { school_id: schoolId, is_active: true },
    });

    const guardians = await primaryGuardians(
      repositories,
      schoolId,
      students.map((student) => student.id),
    );

    const rows: ReportRow[] = students.map((student) => {
      const guardian = guardians.get(student.id);
      return {
        admission_number: student.admission_number,
        name: `${student.first_name} ${student.last_name}`.trim(),
        grade_level: student.grade_level ?? '',
        guardian: guardian ? `${guardian.first_name} ${guardian.last_name}`.trim() : '',
        guardian_phone: guardian?.phone ?? '',
        created_at: isoDate(student.created_at),
      };
    });

    return {
      summary: [
        card('unassigned', 'Without transport', count, `of ${totalActive} active pupils`),
        card('assigned', 'With a stop', Math.max(0, totalActive - count)),
        card('coverage', 'Coverage %', percentage(totalActive - count, totalActive)),
      ],
      rows,
      total: count,
    };
  },
};

/** The full roster: one row per pupil with their transport allocation. */
export const studentRosterReport: ReportDefinition = {
  report: ReportType.STUDENT_ROSTER,
  label: 'Student transport roster',
  description: 'Every pupil with their route, stop, bus and primary guardian.',
  category: 'students',
  filters: ['search', 'status', 'route_id', 'stop_id'],
  fileBase: 'student_roster',
  columns: [
    { key: 'admission_number', label: 'Admission number', type: 'text' },
    { key: 'name', label: 'Student', type: 'text' },
    { key: 'grade_level', label: 'Grade', type: 'text' },
    { key: 'route_code', label: 'Route', type: 'text' },
    { key: 'stop_name', label: 'Stop', type: 'text' },
    { key: 'bus', label: 'Bus', type: 'text' },
    { key: 'guardian', label: 'Primary guardian', type: 'text' },
    { key: 'guardian_phone', label: 'Guardian phone', type: 'text' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const where: Record<string, unknown> = { school_id: schoolId };
    if (query.status === 'active') where.is_active = true;
    if (query.status === 'inactive') where.is_active = false;
    if (query.search) {
      const pattern = `%${escapeLikePattern(query.search)}%`;
      where[Op.or as unknown as string] = [
        { first_name: { [Op.iLike]: pattern } },
        { last_name: { [Op.iLike]: pattern } },
        { admission_number: { [Op.iLike]: pattern } },
      ];
    }

    if (query.stop_id) {
      where.home_stop_id = query.stop_id;
    } else if (query.route_id) {
      const stops = await repositories.stops.findAll({
        where: { school_id: schoolId, route_id: query.route_id },
        attributes: ['id'],
      });
      where.home_stop_id = { [Op.in]: stops.map((stop) => stop.id) };
    }

    const { rows: students, count } = await repositories.students.findAndCountAll({
      where: where as WhereOptions,
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
      ],
      offset: pagination.offset,
      limit: pagination.limit,
    });

    const stops = await repositories.stops.findAll({
      where: {
        school_id: schoolId,
        id: {
          [Op.in]: [
            ...new Set(
              students
                .map((student) => student.home_stop_id)
                .filter((id): id is string => Boolean(id)),
            ),
          ],
        },
      },
      attributes: ['id', 'name', 'route_id'],
    });
    const stopById = new Map(stops.map((stop) => [stop.id, stop]));

    const routeIds = [...new Set(stops.map((stop) => stop.route_id))];
    const [routes, assignments] = await Promise.all([
      routeIds.length
        ? repositories.routes.findAll({
            where: { school_id: schoolId, id: { [Op.in]: routeIds } },
            attributes: ['id', 'code'],
          })
        : Promise.resolve([]),
      routeIds.length
        ? repositories.assignments.findAll({
            where: {
              school_id: schoolId,
              route_id: { [Op.in]: routeIds },
              is_active: true,
              bus_id: { [Op.ne]: null },
            },
            attributes: ['route_id', 'bus_id'],
          })
        : Promise.resolve([]),
    ]);

    const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));
    const buses = assignments.length
      ? await repositories.buses.findAll({
          where: {
            school_id: schoolId,
            id: {
              [Op.in]: [
                ...new Set(
                  assignments.map((item) => item.bus_id).filter((id): id is string => Boolean(id)),
                ),
              ],
            },
          },
          attributes: ['id', 'registration_number'],
        })
      : [];
    const busById = new Map(buses.map((bus) => [bus.id, bus.registration_number]));
    const busByRoute = new Map<string, string>();
    for (const assignment of assignments) {
      if (!assignment.bus_id || busByRoute.has(assignment.route_id)) continue;
      const registration = busById.get(assignment.bus_id);
      if (registration) {
        busByRoute.set(assignment.route_id, registration);
      }
    }

    const guardians = await primaryGuardians(
      repositories,
      schoolId,
      students.map((student) => student.id),
    );

    const rows: ReportRow[] = students.map((student) => {
      const stop = student.home_stop_id ? stopById.get(student.home_stop_id) : undefined;
      const guardian = guardians.get(student.id);
      return {
        admission_number: student.admission_number,
        name: `${student.first_name} ${student.last_name}`.trim(),
        grade_level: student.grade_level ?? '',
        route_code: stop ? (routeCodeById.get(stop.route_id) ?? '') : '',
        stop_name: stop?.name ?? '',
        bus: stop ? (busByRoute.get(stop.route_id) ?? '') : '',
        guardian: guardian ? `${guardian.first_name} ${guardian.last_name}`.trim() : '',
        guardian_phone: guardian?.phone ?? '',
        active: student.is_active ? 'Yes' : 'No',
      };
    });

    const [activeCount, allocatedCount] = await Promise.all([
      repositories.students.count({ where: { school_id: schoolId, is_active: true } }),
      repositories.students.count({
        where: { school_id: schoolId, is_active: true, home_stop_id: { [Op.ne]: null } },
      }),
    ]);

    return {
      summary: [
        card('matching', 'Matching pupils', count),
        card('active', 'Active pupils', activeCount),
        card('allocated', 'With a stop', allocatedCount),
        card('coverage', 'Coverage %', percentage(allocatedCount, activeCount)),
      ],
      rows,
      total: count,
    };
  },
};

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

function emptyBusSummary() {
  return [
    card('buses', 'Buses', 0),
    card('students', 'Students carried', 0),
    card('capacity', 'Total capacity', 0),
    card('overloaded', 'Over capacity', 0),
  ];
}

/** Total seats of the buses rostered on each route. */
async function seatsByRoute(
  repositories: ReportRepositories,
  schoolId: string,
  routeIds: string[],
): Promise<Map<string, number>> {
  if (routeIds.length === 0) {
    return new Map();
  }

  const assignments = await repositories.assignments.findAll({
    where: {
      school_id: schoolId,
      route_id: { [Op.in]: routeIds },
      is_active: true,
      role: RouteAssignmentRole.DRIVER,
      bus_id: { [Op.ne]: null },
    },
    attributes: ['route_id', 'bus_id'],
  });
  if (assignments.length === 0) {
    return new Map();
  }

  const buses = await repositories.buses.findAll({
    where: {
      school_id: schoolId,
      id: {
        [Op.in]: [
          ...new Set(
            assignments.map((item) => item.bus_id).filter((id): id is string => Boolean(id)),
          ),
        ],
      },
    },
    attributes: ['id', 'capacity'],
  });
  const capacityById = new Map(buses.map((bus) => [bus.id, bus.capacity]));

  // A bus rostered twice on the same route contributes its seats once.
  const busesByRoute = new Map<string, Set<string>>();
  for (const assignment of assignments) {
    if (!assignment.bus_id) continue;
    const set = busesByRoute.get(assignment.route_id) ?? new Set<string>();
    set.add(assignment.bus_id);
    busesByRoute.set(assignment.route_id, set);
  }

  const seats = new Map<string, number>();
  for (const [routeId, busIds] of busesByRoute) {
    let total = 0;
    for (const busId of busIds) {
      total += capacityById.get(busId) ?? 0;
    }
    seats.set(routeId, total);
  }
  return seats;
}

/** Primary (or first active) guardian of each student. */
async function primaryGuardians(
  repositories: ReportRepositories,
  schoolId: string,
  studentIds: string[],
): Promise<Map<string, { first_name: string; last_name: string; phone: string | null }>> {
  const result = new Map<string, { first_name: string; last_name: string; phone: string | null }>();
  if (studentIds.length === 0) {
    return result;
  }

  const links = await repositories.guardians.findAll({
    where: { school_id: schoolId, student_id: { [Op.in]: studentIds }, is_active: true },
    attributes: ['student_id', 'user_id', 'is_primary'],
    order: [
      ['is_primary', 'DESC'],
      ['created_at', 'ASC'],
    ],
  });

  const parentByStudent = new Map<string, string>();
  for (const link of links) {
    if (!parentByStudent.has(link.student_id)) {
      parentByStudent.set(link.student_id, link.user_id);
    }
  }
  if (parentByStudent.size === 0) {
    return result;
  }

  const parents = await repositories.users.findAll({
    where: { school_id: schoolId, id: { [Op.in]: [...new Set(parentByStudent.values())] } },
    attributes: ['id', 'first_name', 'last_name', 'phone'],
  });
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));

  for (const [studentId, parentId] of parentByStudent) {
    const parent = parentById.get(parentId);
    if (parent) {
      result.set(studentId, {
        first_name: parent.first_name,
        last_name: parent.last_name,
        phone: parent.phone,
      });
    }
  }
  return result;
}
