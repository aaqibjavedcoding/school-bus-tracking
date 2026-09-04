import { Op, type WhereOptions } from 'sequelize';
import { ExportDataset, TripAttendanceStatus } from '@school-bus-tracking/shared-types';
import type { SheetCell } from '../../excel/excel.util';
import {
  dateRangeClause,
  formatBoolean,
  formatDate,
  formatDateTime,
  searchClause,
  text,
  type ExportDefinition,
  type ExportRepositories,
} from '../export.types';

/**
 * Operational datasets: trips, attendance, notifications and compliance
 * documents.
 *
 * These are the high-volume tables, so every one of them is date-bounded in
 * practice (the UI always sends a range) and paged through the same streaming
 * writer as the rest.
 *
 * Document exports carry the *metadata* only — type, number, dates, status.
 * `file_url` is intentionally never emitted: it is an internal storage handle,
 * and putting it in a shareable spreadsheet would turn "here is the compliance
 * summary" into "here are links to every scanned licence".
 */

export const tripsExport: ExportDefinition = {
  dataset: ExportDataset.TRIPS,
  label: 'Trips',
  fileBase: 'trips',
  supportedFilters: ['status', 'route_id', 'bus_id', 'driver_id', 'date_from', 'date_to'],
  columns: [
    { header: 'Route Code', width: 14 },
    { header: 'Route Name', width: 26 },
    { header: 'Bus Registration', width: 20 },
    { header: 'Driver', width: 24 },
    { header: 'Conductor', width: 24 },
    { header: 'Status', width: 14 },
    { header: 'Scheduled Start', width: 18 },
    { header: 'Scheduled End', width: 18 },
    { header: 'Actual Start', width: 18 },
    { header: 'Actual End', width: 18 },
    { header: 'Students Boarded', width: 18 },
    { header: 'Students Not Boarded', width: 20 },
    { header: 'Cancellation Reason', width: 30 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      ...dateRangeClause('scheduled_start_at', query.date_from, query.date_to),
    };
    if (query.status) {
      where.status = query.status;
    }
    if (query.route_id) {
      where.route_id = query.route_id;
    }
    if (query.bus_id) {
      where.bus_id = query.bus_id;
    }
    if (query.driver_id) {
      where.driver_id = query.driver_id;
    }

    const total = await repositories.trips.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const trips = await repositories.trips.findAll({
          where: where as WhereOptions,
          order: [
            ['scheduled_start_at', 'DESC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (trips.length === 0) {
          return [];
        }

        const tripIds = trips.map((trip) => trip.id);
        const crewIds = [
          ...new Set(
            trips
              .flatMap((trip) => [trip.driver_id, trip.conductor_id])
              .filter((id): id is string => Boolean(id)),
          ),
        ];

        const [routes, buses, crew, attendance] = await Promise.all([
          repositories.routes.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(trips.map((trip) => trip.route_id))] },
            },
            attributes: ['id', 'code', 'name'],
          }),
          repositories.buses.findAll({
            where: {
              school_id: schoolId,
              id: {
                [Op.in]: [
                  ...new Set(
                    trips.map((trip) => trip.bus_id).filter((id): id is string => Boolean(id)),
                  ),
                ],
              },
            },
            attributes: ['id', 'registration_number'],
          }),
          crewIds.length
            ? repositories.users.findAll({
                where: { school_id: schoolId, id: { [Op.in]: crewIds } },
                attributes: ['id', 'first_name', 'last_name'],
              })
            : Promise.resolve([]),
          repositories.attendance.findAll({
            where: { school_id: schoolId, trip_id: { [Op.in]: tripIds } },
            attributes: ['trip_id', 'status'],
          }),
        ]);

        const routeById = new Map(routes.map((route) => [route.id, route]));
        const busById = new Map(buses.map((bus) => [bus.id, bus]));
        const userById = new Map(crew.map((user) => [user.id, user]));

        // BOARDED and DROPPED both mean "the pupil travelled"; PENDING is the
        // manifest entry of someone who never got on.
        const boardedByTrip = new Map<string, number>();
        const pendingByTrip = new Map<string, number>();
        for (const record of attendance) {
          const target =
            record.status === TripAttendanceStatus.PENDING ? pendingByTrip : boardedByTrip;
          target.set(record.trip_id, (target.get(record.trip_id) ?? 0) + 1);
        }

        const name = (id: string | null) => {
          if (!id) return '';
          const user = userById.get(id);
          return user ? `${user.first_name} ${user.last_name}`.trim() : '';
        };

        return trips.map((trip) => {
          const route = routeById.get(trip.route_id);
          return [
            text(route?.code),
            text(route?.name),
            trip.bus_id ? text(busById.get(trip.bus_id)?.registration_number) : '',
            name(trip.driver_id),
            name(trip.conductor_id),
            trip.status,
            formatDateTime(trip.scheduled_start_at),
            formatDateTime(trip.scheduled_end_at),
            formatDateTime(trip.actual_start_at),
            formatDateTime(trip.actual_end_at),
            boardedByTrip.get(trip.id) ?? 0,
            pendingByTrip.get(trip.id) ?? 0,
            text(trip.cancellation_reason),
          ];
        });
      },
    };
  },
};

export const attendanceExport: ExportDefinition = {
  dataset: ExportDataset.ATTENDANCE,
  label: 'Attendance',
  fileBase: 'attendance',
  supportedFilters: ['status', 'route_id', 'student_id', 'trip_id', 'date_from', 'date_to'],
  columns: [
    { header: 'Date', width: 12 },
    { header: 'Route Code', width: 14 },
    { header: 'Trip Scheduled Start', width: 20 },
    { header: 'Admission Number', width: 20 },
    { header: 'Student Name', width: 26 },
    { header: 'Status', width: 16 },
    { header: 'Stop', width: 26 },
    { header: 'Boarded At', width: 18 },
    { header: 'Dropped At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    // Attendance rows have no date of their own — they belong to a trip — so a
    // date filter is resolved into the matching trip ids first.
    const tripWhere: Record<string, unknown> = {
      school_id: schoolId,
      ...dateRangeClause('scheduled_start_at', query.date_from, query.date_to),
    };
    if (query.route_id) {
      tripWhere.route_id = query.route_id;
    }
    if (query.trip_id) {
      tripWhere.id = query.trip_id;
    }

    const scopedTrips =
      query.date_from || query.date_to || query.route_id || query.trip_id
        ? await repositories.trips.findAll({
            where: tripWhere as WhereOptions,
            attributes: ['id'],
          })
        : null;

    const where: Record<string, unknown> = { school_id: schoolId };
    if (scopedTrips) {
      where.trip_id = { [Op.in]: scopedTrips.map((trip) => trip.id) };
    }
    if (query.status) {
      where.status = query.status;
    }
    if (query.student_id) {
      where.student_id = query.student_id;
    }

    const total = await repositories.attendance.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const records = await repositories.attendance.findAll({
          where: where as WhereOptions,
          order: [
            ['created_at', 'DESC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (records.length === 0) {
          return [];
        }

        const [trips, students, stops] = await Promise.all([
          repositories.trips.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(records.map((record) => record.trip_id))] },
            },
            attributes: ['id', 'route_id', 'scheduled_start_at'],
          }),
          repositories.students.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(records.map((record) => record.student_id))] },
            },
            attributes: ['id', 'admission_number', 'first_name', 'last_name'],
          }),
          repositories.stops.findAll({
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
          }),
        ]);

        const tripById = new Map(trips.map((trip) => [trip.id, trip]));
        const routes = await repositories.routes.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(trips.map((trip) => trip.route_id))] },
          },
          attributes: ['id', 'code'],
        });
        const routeCodeById = new Map(routes.map((route) => [route.id, route.code]));
        const studentById = new Map(students.map((student) => [student.id, student]));
        const stopNameById = new Map(stops.map((stop) => [stop.id, stop.name]));

        return records.map((record) => {
          const trip = tripById.get(record.trip_id);
          const student = studentById.get(record.student_id);
          return [
            trip ? formatDate(trip.scheduled_start_at) : '',
            trip ? text(routeCodeById.get(trip.route_id)) : '',
            trip ? formatDateTime(trip.scheduled_start_at) : '',
            text(student?.admission_number),
            student ? `${student.first_name} ${student.last_name}`.trim() : '',
            record.status,
            record.stop_id ? text(stopNameById.get(record.stop_id)) : '',
            formatDateTime(record.boarded_at),
            formatDateTime(record.dropped_at),
          ];
        });
      },
    };
  },
};

export const notificationsExport: ExportDefinition = {
  dataset: ExportDataset.NOTIFICATIONS,
  label: 'Notifications',
  fileBase: 'notifications',
  supportedFilters: ['search', 'status', 'student_id', 'date_from', 'date_to'],
  columns: [
    { header: 'Sent At', width: 18 },
    { header: 'Type', width: 22 },
    { header: 'Recipient', width: 26 },
    { header: 'Recipient Email', width: 30 },
    { header: 'Title', width: 32 },
    { header: 'Message', width: 60 },
    { header: 'Student', width: 26 },
    { header: 'Read', width: 10 },
    { header: 'Read At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      ...dateRangeClause('created_at', query.date_from, query.date_to),
      [Op.and]: searchClause(query.search, ['title', 'message']),
    };
    if (query.status === 'read') {
      where.is_read = true;
    } else if (query.status === 'unread') {
      where.is_read = false;
    }
    if (query.student_id) {
      where.student_id = query.student_id;
    }

    const total = await repositories.notifications.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const notifications = await repositories.notifications.findAll({
          where: where as WhereOptions,
          // `payload` is an internal transport detail and is never exported.
          attributes: [
            'id',
            'user_id',
            'student_id',
            'type',
            'title',
            'message',
            'is_read',
            'read_at',
            'created_at',
          ],
          order: [
            ['created_at', 'DESC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (notifications.length === 0) {
          return [];
        }

        const [recipients, students] = await Promise.all([
          repositories.users.findAll({
            where: {
              school_id: schoolId,
              id: { [Op.in]: [...new Set(notifications.map((item) => item.user_id))] },
            },
            attributes: ['id', 'first_name', 'last_name', 'email'],
          }),
          repositories.students.findAll({
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
          }),
        ]);

        const userById = new Map(recipients.map((user) => [user.id, user]));
        const studentById = new Map(students.map((student) => [student.id, student]));

        return notifications.map((notification) => {
          const user = userById.get(notification.user_id);
          const student = notification.student_id
            ? studentById.get(notification.student_id)
            : undefined;
          return [
            formatDateTime(notification.created_at),
            notification.type,
            user ? `${user.first_name} ${user.last_name}`.trim() : '',
            text(user?.email),
            notification.title,
            notification.message,
            student ? `${student.first_name} ${student.last_name}`.trim() : '',
            formatBoolean(notification.is_read),
            formatDateTime(notification.read_at),
          ];
        });
      },
    };
  },
};

export const busDocumentsExport: ExportDefinition = {
  dataset: ExportDataset.BUS_DOCUMENTS,
  label: 'Bus documents',
  fileBase: 'bus_documents',
  supportedFilters: ['bus_id', 'date_from', 'date_to'],
  columns: [
    { header: 'Bus Registration', width: 20 },
    { header: 'Bus Number', width: 14 },
    { header: 'Document Type', width: 24 },
    { header: 'Document Number', width: 24 },
    { header: 'Issue Date', width: 14 },
    { header: 'Expiry Date', width: 14 },
    { header: 'Has File', width: 12 },
    { header: 'Notes', width: 40 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = { school_id: schoolId };
    if (query.bus_id) {
      where.bus_id = query.bus_id;
    }
    if (query.date_from) {
      where.expiry_date = { ...(where.expiry_date as object), [Op.gte]: query.date_from };
    }
    if (query.date_to) {
      where.expiry_date = { ...(where.expiry_date as object), [Op.lte]: query.date_to };
    }

    const total = await repositories.busDocuments.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const documents = await repositories.busDocuments.findAll({
          where: where as WhereOptions,
          attributes: [
            'id',
            'bus_id',
            'document_type',
            'document_number',
            'issue_date',
            'expiry_date',
            'file_name',
            'notes',
          ],
          order: [
            ['expiry_date', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (documents.length === 0) {
          return [];
        }

        const buses = await repositories.buses.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(documents.map((document) => document.bus_id))] },
          },
          attributes: ['id', 'registration_number', 'bus_number'],
        });
        const busById = new Map(buses.map((bus) => [bus.id, bus]));

        return documents.map((document) => {
          const bus = busById.get(document.bus_id);
          return [
            text(bus?.registration_number),
            text(bus?.bus_number),
            document.document_type,
            text(document.document_number),
            formatDate(document.issue_date),
            formatDate(document.expiry_date),
            formatBoolean(Boolean(document.file_name)),
            text(document.notes),
          ];
        });
      },
    };
  },
};

export const driverDocumentsExport: ExportDefinition = {
  dataset: ExportDataset.DRIVER_DOCUMENTS,
  label: 'Driver documents',
  fileBase: 'driver_documents',
  supportedFilters: ['driver_id', 'date_from', 'date_to'],
  columns: [
    { header: 'Driver Name', width: 26 },
    { header: 'Driver Email', width: 30 },
    { header: 'Document Type', width: 24 },
    { header: 'Document Number', width: 24 },
    { header: 'Issue Date', width: 14 },
    { header: 'Expiry Date', width: 14 },
    { header: 'Has File', width: 12 },
    { header: 'Notes', width: 40 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = { school_id: schoolId };
    if (query.driver_id) {
      where.driver_id = query.driver_id;
    }
    if (query.date_from) {
      where.expiry_date = { ...(where.expiry_date as object), [Op.gte]: query.date_from };
    }
    if (query.date_to) {
      where.expiry_date = { ...(where.expiry_date as object), [Op.lte]: query.date_to };
    }

    const total = await repositories.driverDocuments.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const documents = await repositories.driverDocuments.findAll({
          where: where as WhereOptions,
          attributes: [
            'id',
            'driver_id',
            'document_type',
            'document_number',
            'issue_date',
            'expiry_date',
            'file_name',
            'notes',
          ],
          order: [
            ['expiry_date', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (documents.length === 0) {
          return [];
        }

        const drivers = await repositories.users.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(documents.map((document) => document.driver_id))] },
          },
          attributes: ['id', 'first_name', 'last_name', 'email'],
        });
        const driverById = new Map(drivers.map((driver) => [driver.id, driver]));

        return documents.map((document) => {
          const driver = driverById.get(document.driver_id);
          return [
            driver ? `${driver.first_name} ${driver.last_name}`.trim() : '',
            text(driver?.email),
            document.document_type,
            text(document.document_number),
            formatDate(document.issue_date),
            formatDate(document.expiry_date),
            formatBoolean(Boolean(document.file_name)),
            text(document.notes),
          ];
        });
      },
    };
  },
};

export type { ExportRepositories };
