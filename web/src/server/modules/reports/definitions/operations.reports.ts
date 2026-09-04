import { Op, type WhereOptions } from 'sequelize';
import {
  DocumentStatus,
  ReportType,
  TripAttendanceStatus,
  TripStatus,
} from '@school-bus-tracking/shared-types';
import { deriveDocumentStatus } from '@school-bus-tracking/validation';
import {
  card,
  dateRange,
  isoDate,
  isoDateTime,
  paginateRows,
  percentage,
  type ReportDefinition,
  type ReportRepositories,
  type ReportRow,
} from '../report.types';

/**
 * Operational reports: fleet utilisation, crew rosters, trips, attendance,
 * notifications and compliance.
 *
 * The trip-shaped reports are date-bounded by default (the UI always sends a
 * range) because `trips`, `trip_student_attendance` and `notifications` are the
 * three tables that grow without bound.
 */

/** Fleet utilisation: seats offered against pupils actually allocated. */
export const busUtilizationReport: ReportDefinition = {
  report: ReportType.BUS_UTILIZATION,
  label: 'Bus utilisation',
  description: 'Seats offered, pupils allocated and trips run for each vehicle.',
  category: 'transport',
  filters: ['bus_id', 'status', 'date_from', 'date_to'],
  fileBase: 'bus_utilization',
  columns: [
    { key: 'registration_number', label: 'Registration', type: 'text' },
    { key: 'bus_number', label: 'Bus number', type: 'text' },
    { key: 'capacity', label: 'Capacity', type: 'number' },
    { key: 'routes', label: 'Routes served', type: 'number' },
    { key: 'students', label: 'Students', type: 'number' },
    { key: 'utilisation', label: 'Utilisation %', type: 'number' },
    { key: 'trips', label: 'Trips in period', type: 'number' },
    { key: 'active', label: 'Active', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const where: Record<string, unknown> = { school_id: schoolId };
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

    const assignments = await repositories.assignments.findAll({
      where: { school_id: schoolId, bus_id: { [Op.in]: busIds }, is_active: true },
      attributes: ['bus_id', 'route_id'],
    });

    const routeIdsByBus = new Map<string, Set<string>>();
    for (const assignment of assignments) {
      if (!assignment.bus_id) continue;
      const set = routeIdsByBus.get(assignment.bus_id) ?? new Set<string>();
      set.add(assignment.route_id);
      routeIdsByBus.set(assignment.bus_id, set);
    }

    const routeIds = [...new Set(assignments.map((item) => item.route_id))];
    const stops = routeIds.length
      ? await repositories.stops.findAll({
          where: { school_id: schoolId, route_id: { [Op.in]: routeIds } },
          attributes: ['id', 'route_id'],
        })
      : [];
    const routeByStop = new Map(stops.map((stop) => [stop.id, stop.route_id]));

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
    const studentsByRoute = new Map<string, number>();
    for (const student of students) {
      const routeId = student.home_stop_id ? routeByStop.get(student.home_stop_id) : undefined;
      if (!routeId) continue;
      studentsByRoute.set(routeId, (studentsByRoute.get(routeId) ?? 0) + 1);
    }

    const tripWhere: Record<string, unknown> = {
      school_id: schoolId,
      bus_id: { [Op.in]: busIds },
    };
    const range = dateRange(query.date_from, query.date_to);
    if (range) {
      tripWhere.scheduled_start_at = range;
    }
    const trips = await repositories.trips.findAll({
      where: tripWhere as WhereOptions,
      attributes: ['bus_id'],
    });
    const tripsByBus = new Map<string, number>();
    for (const trip of trips) {
      if (!trip.bus_id) continue;
      tripsByBus.set(trip.bus_id, (tripsByBus.get(trip.bus_id) ?? 0) + 1);
    }

    const rows: ReportRow[] = buses.map((bus) => {
      const routeIdsForBus = [...(routeIdsByBus.get(bus.id) ?? [])];
      const studentCount = routeIdsForBus.reduce(
        (sum, routeId) => sum + (studentsByRoute.get(routeId) ?? 0),
        0,
      );
      return {
        registration_number: bus.registration_number,
        bus_number: bus.bus_number ?? '',
        capacity: bus.capacity,
        routes: routeIdsForBus.length,
        students: studentCount,
        utilisation: percentage(studentCount, bus.capacity),
        trips: tripsByBus.get(bus.id) ?? 0,
        active: bus.is_active ? 'Yes' : 'No',
      };
    });

    const totalCapacity = rows.reduce((sum, row) => sum + Number(row.capacity), 0);
    const totalStudents = rows.reduce((sum, row) => sum + Number(row.students), 0);
    const idle = rows.filter((row) => Number(row.routes) === 0).length;

    return {
      summary: [
        card('buses', 'Buses', rows.length),
        card('capacity', 'Total seats', totalCapacity),
        card('utilisation', 'Fleet utilisation %', percentage(totalStudents, totalCapacity)),
        card('idle', 'Not rostered', idle, idle > 0 ? 'Buses with no active route' : null),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/** Who drives and conducts each route, and which routes have nobody. */
export const crewAssignmentsReport: ReportDefinition = {
  report: ReportType.CREW_ASSIGNMENTS,
  label: 'Crew assignments',
  description: 'Driver, conductor and vehicle rostered on each route today.',
  category: 'transport',
  filters: ['route_id', 'driver_id', 'status'],
  fileBase: 'crew_assignments',
  columns: [
    { key: 'route_code', label: 'Route code', type: 'text' },
    { key: 'route_name', label: 'Route', type: 'text' },
    { key: 'driver', label: 'Driver', type: 'text' },
    { key: 'driver_phone', label: 'Driver phone', type: 'text' },
    { key: 'conductor', label: 'Conductor', type: 'text' },
    { key: 'bus', label: 'Bus', type: 'text' },
    { key: 'effective_from', label: 'From', type: 'date' },
    { key: 'effective_to', label: 'To', type: 'date' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const routeWhere: Record<string, unknown> = { school_id: schoolId };
    if (query.route_id) routeWhere.id = query.route_id;
    if (query.status === 'active') routeWhere.is_active = true;
    if (query.status === 'inactive') routeWhere.is_active = false;

    const routes = await repositories.routes.findAll({
      where: routeWhere as WhereOptions,
      order: [['code', 'ASC']],
    });
    if (routes.length === 0) {
      return { summary: [], rows: [], total: 0 };
    }

    const assignmentWhere: Record<string, unknown> = {
      school_id: schoolId,
      route_id: { [Op.in]: routes.map((route) => route.id) },
      is_active: true,
    };
    if (query.driver_id) {
      assignmentWhere.user_id = query.driver_id;
    }

    const assignments = await repositories.assignments.findAll({
      where: assignmentWhere as WhereOptions,
      order: [['effective_from', 'DESC']],
    });

    const [crew, buses] = await Promise.all([
      assignments.length
        ? repositories.users.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(assignments.map((item) => item.user_id))] },
            },
            attributes: ['id', 'first_name', 'last_name', 'phone'],
          })
        : Promise.resolve([]),
      assignments.length
        ? repositories.buses.findAll({
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
          })
        : Promise.resolve([]),
    ]);

    const userById = new Map(crew.map((user) => [user.id, user]));
    const busById = new Map(buses.map((bus) => [bus.id, bus.registration_number]));

    // The most recent active roster per route and role wins; that is what the
    // crew is today.
    const byRoute = new Map<
      string,
      { driver?: (typeof assignments)[number]; conductor?: (typeof assignments)[number] }
    >();
    for (const assignment of assignments) {
      const entry = byRoute.get(assignment.route_id) ?? {};
      if (assignment.role === 'DRIVER' && !entry.driver) {
        entry.driver = assignment;
      } else if (assignment.role === 'CONDUCTOR' && !entry.conductor) {
        entry.conductor = assignment;
      }
      byRoute.set(assignment.route_id, entry);
    }

    const name = (userId: string | undefined) => {
      if (!userId) return '';
      const user = userById.get(userId);
      return user ? `${user.first_name} ${user.last_name}`.trim() : '';
    };

    const rows: ReportRow[] = routes
      // With a crew filter, routes that person is not on are noise.
      .filter((route) => !query.driver_id || byRoute.has(route.id))
      .map((route) => {
        const entry = byRoute.get(route.id) ?? {};
        const primary = entry.driver ?? entry.conductor;
        const driverUser = entry.driver ? userById.get(entry.driver.user_id) : undefined;
        return {
          route_code: route.code,
          route_name: route.name,
          driver: name(entry.driver?.user_id),
          driver_phone: driverUser?.phone ?? '',
          conductor: name(entry.conductor?.user_id),
          bus: primary?.bus_id ? (busById.get(primary.bus_id) ?? '') : '',
          effective_from: primary ? isoDate(primary.effective_from) : '',
          effective_to: primary?.effective_to ? isoDate(primary.effective_to) : '',
        };
      });

    const withoutDriver = rows.filter((row) => !row.driver).length;
    const withoutBus = rows.filter((row) => !row.bus).length;

    return {
      summary: [
        card('routes', 'Routes', rows.length),
        card('crewed', 'With a driver', rows.length - withoutDriver),
        card(
          'no_driver',
          'Without a driver',
          withoutDriver,
          withoutDriver > 0 ? 'These routes cannot run' : null,
        ),
        card('no_bus', 'Without a bus', withoutBus),
      ],
      rows: paginateRows(rows, pagination.offset, pagination.limit),
      total: rows.length,
    };
  },
};

/** Trip history with on-time and completion figures. */
export const tripsReport: ReportDefinition = {
  report: ReportType.TRIPS,
  label: 'Trips',
  description: 'Every scheduled run in the period with its outcome and crew.',
  category: 'trips',
  filters: ['route_id', 'bus_id', 'driver_id', 'trip_status', 'date_from', 'date_to'],
  fileBase: 'trips_report',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'route_code', label: 'Route', type: 'text' },
    { key: 'bus', label: 'Bus', type: 'text' },
    { key: 'driver', label: 'Driver', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'scheduled_start', label: 'Scheduled start', type: 'text' },
    { key: 'actual_start', label: 'Actual start', type: 'text' },
    { key: 'actual_end', label: 'Actual end', type: 'text' },
    { key: 'boarded', label: 'Boarded', type: 'number' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const where: Record<string, unknown> = { school_id: schoolId };
    const range = dateRange(query.date_from, query.date_to);
    if (range) {
      where.scheduled_start_at = range;
    }
    if (query.route_id) where.route_id = query.route_id;
    if (query.bus_id) where.bus_id = query.bus_id;
    if (query.driver_id) where.driver_id = query.driver_id;
    if (query.trip_status) where.status = query.trip_status;

    const { rows: trips, count } = await repositories.trips.findAndCountAll({
      where: where as WhereOptions,
      order: [['scheduled_start_at', 'DESC']],
      offset: pagination.offset,
      limit: pagination.limit,
    });

    // Status mix over the *whole* filtered period, not just this page — the
    // summary cards would be meaningless otherwise.
    const statusCounts = await countByStatus(repositories, schoolId, where);

    const rows: ReportRow[] = trips.length
      ? await decorateTrips(repositories, schoolId, trips)
      : [];

    const completed = statusCounts.get(TripStatus.COMPLETED) ?? 0;
    const cancelled = statusCounts.get(TripStatus.CANCELLED) ?? 0;

    return {
      summary: [
        card('total', 'Trips', count),
        card('completed', 'Completed', completed, `${percentage(completed, count)}% of trips`),
        card('cancelled', 'Cancelled', cancelled),
        card(
          'in_progress',
          'Running or scheduled',
          (statusCounts.get(TripStatus.SCHEDULED) ?? 0) +
            (statusCounts.get(TripStatus.BOARDING) ?? 0) +
            (statusCounts.get(TripStatus.IN_PROGRESS) ?? 0),
        ),
      ],
      rows,
      total: count,
    };
  },
};

/** Attendance history: who travelled, who did not. */
export const attendanceReport: ReportDefinition = {
  report: ReportType.ATTENDANCE,
  label: 'Attendance',
  description: 'Per-pupil boarding records for the selected period.',
  category: 'attendance',
  filters: ['route_id', 'student_id', 'attendance_status', 'date_from', 'date_to'],
  fileBase: 'attendance_report',
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'route_code', label: 'Route', type: 'text' },
    { key: 'admission_number', label: 'Admission number', type: 'text' },
    { key: 'student', label: 'Student', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'stop_name', label: 'Stop', type: 'text' },
    { key: 'boarded_at', label: 'Boarded at', type: 'text' },
    { key: 'dropped_at', label: 'Dropped at', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    // Attendance inherits its date from the trip, so trips are scoped first.
    const tripWhere: Record<string, unknown> = { school_id: schoolId };
    const range = dateRange(query.date_from, query.date_to);
    if (range) {
      tripWhere.scheduled_start_at = range;
    }
    if (query.route_id) {
      tripWhere.route_id = query.route_id;
    }

    const scopedTrips = await repositories.trips.findAll({
      where: tripWhere as WhereOptions,
      attributes: ['id', 'route_id', 'scheduled_start_at'],
    });
    const tripById = new Map(scopedTrips.map((trip) => [trip.id, trip]));

    if (scopedTrips.length === 0) {
      return { summary: emptyAttendanceSummary(), rows: [], total: 0 };
    }

    const where: Record<string, unknown> = {
      school_id: schoolId,
      trip_id: { [Op.in]: scopedTrips.map((trip) => trip.id) },
    };
    if (query.student_id) where.student_id = query.student_id;
    if (query.attendance_status) where.status = query.attendance_status;

    const { rows: records, count } = await repositories.attendance.findAndCountAll({
      where: where as WhereOptions,
      order: [['created_at', 'DESC']],
      offset: pagination.offset,
      limit: pagination.limit,
    });

    const statusTotals = await attendanceStatusTotals(repositories, schoolId, where);

    const [students, stops, routes] = await Promise.all([
      records.length
        ? repositories.students.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(records.map((record) => record.student_id))] },
            },
            attributes: ['id', 'admission_number', 'first_name', 'last_name'],
          })
        : Promise.resolve([]),
      records.length
        ? repositories.stops.findAll({
            where: {
              school_id: schoolId,
              id: {
                [Op.in]: [
                  ...new Set(
                    records
                      .map((record) => record.stop_id)
                      .filter((id): id is string => Boolean(id)),
                  ),
                ],
              },
            },
            attributes: ['id', 'name'],
          })
        : Promise.resolve([]),
      repositories.routes.findAll({
        where: {
          school_id: schoolId,
          id: { [Op.in]: [...new Set(scopedTrips.map((trip) => trip.route_id))] },
        },
        attributes: ['id', 'code'],
      }),
    ]);

    const studentById = new Map(students.map((student) => [student.id, student]));
    const stopNameById = new Map(stops.map((stop) => [stop.id, stop.name]));
    const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));

    const rows: ReportRow[] = records.map((record) => {
      const trip = tripById.get(record.trip_id);
      const student = studentById.get(record.student_id);
      return {
        date: trip ? isoDate(trip.scheduled_start_at) : '',
        route_code: trip ? (routeCodeById.get(trip.route_id) ?? '') : '',
        admission_number: student?.admission_number ?? '',
        student: student ? `${student.first_name} ${student.last_name}`.trim() : '',
        status: record.status,
        stop_name: record.stop_id ? (stopNameById.get(record.stop_id) ?? '') : '',
        boarded_at: isoDateTime(record.boarded_at),
        dropped_at: isoDateTime(record.dropped_at),
      };
    });

    const travelled =
      (statusTotals.get(TripAttendanceStatus.BOARDED) ?? 0) +
      (statusTotals.get(TripAttendanceStatus.DROPPED) ?? 0);
    const pending = statusTotals.get(TripAttendanceStatus.PENDING) ?? 0;

    return {
      summary: [
        card('records', 'Attendance records', count),
        card('travelled', 'Travelled', travelled),
        card('pending', 'Never boarded', pending),
        card('rate', 'Boarding rate %', percentage(travelled, travelled + pending)),
      ],
      rows,
      total: count,
    };
  },
};

/** Notification volume and read-through. */
export const notificationsReport: ReportDefinition = {
  report: ReportType.NOTIFICATIONS,
  label: 'Notifications',
  description: 'What the school sent, to whom, and whether it was read.',
  category: 'trips',
  filters: ['status', 'student_id', 'date_from', 'date_to'],
  fileBase: 'notifications_report',
  columns: [
    { key: 'sent_at', label: 'Sent', type: 'text' },
    { key: 'type', label: 'Type', type: 'text' },
    { key: 'recipient', label: 'Recipient', type: 'text' },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'student', label: 'Student', type: 'text' },
    { key: 'read', label: 'Read', type: 'text' },
    { key: 'read_at', label: 'Read at', type: 'text' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const where: Record<string, unknown> = { school_id: schoolId };
    const range = dateRange(query.date_from, query.date_to);
    if (range) {
      where.created_at = range;
    }
    if (query.status === 'read') where.is_read = true;
    if (query.status === 'unread') where.is_read = false;
    if (query.student_id) where.student_id = query.student_id;

    const { rows: notifications, count } = await repositories.notifications.findAndCountAll({
      where: where as WhereOptions,
      attributes: [
        'id',
        'user_id',
        'student_id',
        'type',
        'title',
        'is_read',
        'read_at',
        'created_at',
      ],
      order: [['created_at', 'DESC']],
      offset: pagination.offset,
      limit: pagination.limit,
    });

    const readCount = await repositories.notifications.count({
      where: { ...(where as object), is_read: true } as WhereOptions,
    });

    const [recipients, students] = await Promise.all([
      notifications.length
        ? repositories.users.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(notifications.map((item) => item.user_id))] },
            },
            attributes: ['id', 'first_name', 'last_name'],
          })
        : Promise.resolve([]),
      notifications.length
        ? repositories.students.findAll({
            where: {
              school_id: schoolId,
              id: {
                [Op.in]: [
                  ...new Set(
                    notifications
                      .map((item) => item.student_id)
                      .filter((id): id is string => Boolean(id)),
                  ),
                ],
              },
            },
            attributes: ['id', 'first_name', 'last_name'],
          })
        : Promise.resolve([]),
    ]);

    const userById = new Map(recipients.map((user) => [user.id, user]));
    const studentById = new Map(students.map((student) => [student.id, student]));

    const rows: ReportRow[] = notifications.map((notification) => {
      const user = userById.get(notification.user_id);
      const student = notification.student_id
        ? studentById.get(notification.student_id)
        : undefined;
      return {
        sent_at: isoDateTime(notification.created_at),
        type: notification.type,
        recipient: user ? `${user.first_name} ${user.last_name}`.trim() : '',
        title: notification.title,
        student: student ? `${student.first_name} ${student.last_name}`.trim() : '',
        read: notification.is_read ? 'Yes' : 'No',
        read_at: isoDateTime(notification.read_at),
      };
    });

    return {
      summary: [
        card('sent', 'Notifications sent', count),
        card('read', 'Read', readCount, `${percentage(readCount, count)}% read`),
        card('unread', 'Unread', Math.max(0, count - readCount)),
      ],
      rows,
      total: count,
    };
  },
};

/** Compliance: which bus and driver documents are expired or expiring. */
export const documentsReport: ReportDefinition = {
  report: ReportType.DOCUMENTS,
  label: 'Document compliance',
  description: 'Expiry status of every bus and driver document on file.',
  category: 'compliance',
  filters: ['status', 'bus_id', 'driver_id'],
  fileBase: 'document_compliance',
  columns: [
    { key: 'owner_type', label: 'Owner type', type: 'text' },
    { key: 'owner', label: 'Owner', type: 'text' },
    { key: 'document_type', label: 'Document', type: 'text' },
    { key: 'document_number', label: 'Number', type: 'text' },
    { key: 'issue_date', label: 'Issued', type: 'date' },
    { key: 'expiry_date', label: 'Expires', type: 'date' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'days_remaining', label: 'Days remaining', type: 'number' },
  ],

  async run(repositories, schoolId, query, pagination) {
    const busWhere: Record<string, unknown> = { school_id: schoolId };
    if (query.bus_id) busWhere.bus_id = query.bus_id;
    const driverWhere: Record<string, unknown> = { school_id: schoolId };
    if (query.driver_id) driverWhere.driver_id = query.driver_id;

    // A driver filter means "driver documents only", and vice versa.
    const [busDocuments, driverDocuments] = await Promise.all([
      query.driver_id
        ? Promise.resolve([])
        : repositories.busDocuments.findAll({ where: busWhere as WhereOptions }),
      query.bus_id
        ? Promise.resolve([])
        : repositories.driverDocuments.findAll({ where: driverWhere as WhereOptions }),
    ]);

    const [buses, drivers] = await Promise.all([
      busDocuments.length
        ? repositories.buses.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(busDocuments.map((document) => document.bus_id))] },
            },
            attributes: ['id', 'registration_number'],
          })
        : Promise.resolve([]),
      driverDocuments.length
        ? repositories.users.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(driverDocuments.map((document) => document.driver_id))] },
            },
            attributes: ['id', 'first_name', 'last_name'],
          })
        : Promise.resolve([]),
    ]);

    const busById = new Map(buses.map((bus) => [bus.id, bus.registration_number]));
    const driverById = new Map(
      drivers.map((driver) => [driver.id, `${driver.first_name} ${driver.last_name}`.trim()]),
    );

    const now = new Date();
    const all: ReportRow[] = [
      ...busDocuments.map((document) => ({
        owner_type: 'Bus',
        owner: busById.get(document.bus_id) ?? '',
        document_type: document.document_type as string,
        document_number: document.document_number ?? '',
        issue_date: document.issue_date ?? '',
        expiry_date: document.expiry_date ?? '',
        // Reuses the single source of truth the API, web and mobile all call,
        // so a report can never disagree with the compliance screen.
        status: deriveDocumentStatus(document.expiry_date, { now }),
        days_remaining: daysUntil(document.expiry_date, now),
      })),
      ...driverDocuments.map((document) => ({
        owner_type: 'Driver',
        owner: driverById.get(document.driver_id) ?? '',
        document_type: document.document_type as string,
        document_number: document.document_number ?? '',
        issue_date: document.issue_date ?? '',
        expiry_date: document.expiry_date ?? '',
        status: deriveDocumentStatus(document.expiry_date, { now }),
        days_remaining: daysUntil(document.expiry_date, now),
      })),
    ];

    const filtered = query.status
      ? all.filter((row) => String(row.status).toLowerCase() === query.status?.toLowerCase())
      : all;

    // Soonest expiry first: that is the working order for a compliance chase.
    filtered.sort((left, right) => {
      const leftValue =
        left.days_remaining === null ? Number.MAX_SAFE_INTEGER : Number(left.days_remaining);
      const rightValue =
        right.days_remaining === null ? Number.MAX_SAFE_INTEGER : Number(right.days_remaining);
      return leftValue - rightValue;
    });

    const countStatus = (status: DocumentStatus) =>
      all.filter((row) => row.status === status).length;

    return {
      summary: [
        card('documents', 'Documents on file', all.length),
        card('expired', 'Expired', countStatus(DocumentStatus.EXPIRED)),
        card('expiring', 'Expiring soon', countStatus(DocumentStatus.EXPIRING_SOON)),
        card('valid', 'Valid', countStatus(DocumentStatus.VALID)),
      ],
      rows: paginateRows(filtered, pagination.offset, pagination.limit),
      total: filtered.length,
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyAttendanceSummary() {
  return [
    card('records', 'Attendance records', 0),
    card('travelled', 'Travelled', 0),
    card('pending', 'Never boarded', 0),
    card('rate', 'Boarding rate %', 0),
  ];
}

function daysUntil(expiry: string | null, now: Date): number | null {
  if (!expiry) return null;
  const target = new Date(`${expiry}T00:00:00.000Z`).getTime();
  if (Number.isNaN(target)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - today) / 86_400_000);
}

/** Trip counts per status over the whole filtered period. */
async function countByStatus(
  repositories: ReportRepositories,
  schoolId: string,
  where: Record<string, unknown>,
): Promise<Map<TripStatus, number>> {
  const counts = new Map<TripStatus, number>();
  const results = await Promise.all(
    Object.values(TripStatus).map(async (status) => ({
      status,
      count: await repositories.trips.count({
        where: { ...where, school_id: schoolId, status } as WhereOptions,
      }),
    })),
  );
  for (const result of results) {
    counts.set(result.status, result.count);
  }
  return counts;
}

/** Attendance counts per status over the whole filtered period. */
async function attendanceStatusTotals(
  repositories: ReportRepositories,
  schoolId: string,
  where: Record<string, unknown>,
): Promise<Map<TripAttendanceStatus, number>> {
  const totals = new Map<TripAttendanceStatus, number>();
  const results = await Promise.all(
    Object.values(TripAttendanceStatus).map(async (status) => ({
      status,
      count: await repositories.attendance.count({
        where: { ...where, school_id: schoolId, status } as WhereOptions,
      }),
    })),
  );
  for (const result of results) {
    totals.set(result.status, result.count);
  }
  return totals;
}

/** Enriches one page of trips with route, bus, driver and boarding counts. */
async function decorateTrips(
  repositories: ReportRepositories,
  schoolId: string,
  trips: Array<{
    id: string;
    route_id: string;
    bus_id: string | null;
    driver_id: string | null;
    status: TripStatus;
    scheduled_start_at: Date;
    actual_start_at: Date | null;
    actual_end_at: Date | null;
  }>,
): Promise<ReportRow[]> {
  const [routes, buses, drivers, attendance] = await Promise.all([
    repositories.routes.findAll({
      where: { school_id: schoolId, id: { [Op.in]: [...new Set(trips.map((t) => t.route_id))] } },
      attributes: ['id', 'code'],
    }),
    repositories.buses.findAll({
      where: {
        school_id: schoolId,
        id: {
          [Op.in]: [
            ...new Set(trips.map((t) => t.bus_id).filter((id): id is string => Boolean(id))),
          ],
        },
      },
      attributes: ['id', 'registration_number'],
    }),
    repositories.users.findAll({
      where: {
        school_id: schoolId,
        id: {
          [Op.in]: [
            ...new Set(trips.map((t) => t.driver_id).filter((id): id is string => Boolean(id))),
          ],
        },
      },
      attributes: ['id', 'first_name', 'last_name'],
    }),
    repositories.attendance.findAll({
      where: {
        school_id: schoolId,
        trip_id: { [Op.in]: trips.map((trip) => trip.id) },
        status: { [Op.ne]: TripAttendanceStatus.PENDING },
      },
      attributes: ['trip_id'],
    }),
  ]);

  const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));
  const busById = new Map(buses.map((bus) => [bus.id, bus.registration_number]));
  const driverById = new Map(
    drivers.map((driver) => [driver.id, `${driver.first_name} ${driver.last_name}`.trim()]),
  );
  const boardedByTrip = new Map<string, number>();
  for (const record of attendance) {
    boardedByTrip.set(record.trip_id, (boardedByTrip.get(record.trip_id) ?? 0) + 1);
  }

  return trips.map((trip) => ({
    date: isoDate(trip.scheduled_start_at),
    route_code: routeCodeById.get(trip.route_id) ?? '',
    bus: trip.bus_id ? (busById.get(trip.bus_id) ?? '') : '',
    driver: trip.driver_id ? (driverById.get(trip.driver_id) ?? '') : '',
    status: trip.status,
    scheduled_start: isoDateTime(trip.scheduled_start_at),
    actual_start: isoDateTime(trip.actual_start_at),
    actual_end: isoDateTime(trip.actual_end_at),
    boarded: boardedByTrip.get(trip.id) ?? 0,
  }));
}
