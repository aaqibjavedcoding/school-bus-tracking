import { Op, type WhereOptions } from 'sequelize';
import { ExportDataset, UserRole, type ExportQuery } from '@school-bus-tracking/shared-types';
import type { SheetCell } from '../../excel/excel.util';
import {
  activeClause,
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
 * People datasets: students, parents, guardian links, drivers, conductors.
 *
 * ## What is deliberately absent
 *
 * `password_hash`, `email_verified_at` and every token-shaped column are never
 * selected — an export is a business document, not a database dump, and a
 * spreadsheet of bcrypt digests emailed around is exactly the leak this feature
 * must not create.
 *
 * `medical_notes` is also excluded from the student export. The audit-log
 * redaction policy already treats it as sensitive, and it would be inconsistent
 * to scrub it from the audit trail while shipping it in a downloadable file.
 * Medical information stays in the app, behind the record detail screen.
 */

export const studentsExport: ExportDefinition = {
  dataset: ExportDataset.STUDENTS,
  label: 'Students',
  fileBase: 'students',
  supportedFilters: ['search', 'status', 'route_id', 'stop_id'],
  columns: [
    { header: 'Admission Number', width: 20 },
    { header: 'First Name', width: 18 },
    { header: 'Last Name', width: 18 },
    { header: 'Grade', width: 12 },
    { header: 'Gender', width: 10 },
    { header: 'Date Of Birth', width: 14 },
    { header: 'Route Code', width: 14 },
    { header: 'Route Name', width: 26 },
    { header: 'Home Stop', width: 26 },
    { header: 'Emergency Contact Name', width: 24 },
    { header: 'Emergency Contact Phone', width: 22 },
    { header: 'Primary Guardian', width: 24 },
    { header: 'Primary Guardian Email', width: 28 },
    { header: 'Primary Guardian Phone', width: 22 },
    { header: 'Active', width: 10 },
    { header: 'Created At', width: 18 },
  ],

  async prepare(repositories, schoolId, query) {
    const where = {
      school_id: schoolId,
      ...activeClause(query.status),
      [Op.and]: searchClause(query.search, ['first_name', 'last_name', 'admission_number']),
    } as WhereOptions;

    // A route filter has to go through the stops that belong to it, because a
    // student references a stop, not a route.
    const stopIds = await resolveStopScope(repositories, schoolId, query);
    if (stopIds !== null) {
      (where as Record<string, unknown>).home_stop_id = { [Op.in]: stopIds };
    }

    const total = await repositories.students.count({ where });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const students = await repositories.students.findAll({
          where,
          order: [
            ['last_name', 'ASC'],
            ['first_name', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (students.length === 0) {
          return [];
        }

        // Per-page enrichment: three small `IN (…)` queries per 500 rows keeps
        // the export flat in memory without an N+1.
        const stops = await loadStops(
          repositories,
          schoolId,
          students.map((student) => student.home_stop_id),
        );
        const routes = await loadRoutes(
          repositories,
          schoolId,
          [...stops.values()].map((stop) => stop.route_id),
        );
        const guardians = await loadPrimaryGuardians(
          repositories,
          schoolId,
          students.map((student) => student.id),
        );

        return students.map((student) => {
          const stop = student.home_stop_id ? stops.get(student.home_stop_id) : undefined;
          const route = stop ? routes.get(stop.route_id) : undefined;
          const guardian = guardians.get(student.id);

          return [
            student.admission_number,
            student.first_name,
            student.last_name,
            text(student.grade_level),
            text(student.gender),
            formatDate(student.date_of_birth),
            text(route?.code),
            text(route?.name),
            text(stop?.name),
            text(student.emergency_contact_name),
            text(student.emergency_contact_phone),
            guardian ? `${guardian.first_name} ${guardian.last_name}`.trim() : '',
            text(guardian?.email),
            text(guardian?.phone),
            formatBoolean(student.is_active),
            formatDateTime(student.created_at),
          ];
        });
      },
    };
  },
};

/** Shared shape of the three account exports. */
function accountExport(config: {
  dataset: ExportDataset;
  label: string;
  fileBase: string;
  role: UserRole;
}): ExportDefinition {
  return {
    dataset: config.dataset,
    label: config.label,
    fileBase: config.fileBase,
    supportedFilters: ['search', 'status'],
    columns: [
      { header: 'First Name', width: 18 },
      { header: 'Last Name', width: 18 },
      { header: 'Email', width: 30 },
      { header: 'Phone', width: 18 },
      { header: 'Active', width: 10 },
      { header: 'Created At', width: 18 },
    ],

    async prepare(repositories, schoolId, query) {
      const where = {
        school_id: schoolId,
        role: config.role,
        ...activeClause(query.status),
        [Op.and]: searchClause(query.search, ['first_name', 'last_name', 'email']),
      } as WhereOptions;

      const total = await repositories.users.count({ where });

      return {
        total,
        async loadPage(offset, limit): Promise<SheetCell[][]> {
          const users = await repositories.users.findAll({
            where,
            // Selecting explicitly is the structural guarantee that
            // `password_hash` can never reach a spreadsheet.
            attributes: [
              'id',
              'first_name',
              'last_name',
              'email',
              'phone',
              'is_active',
              'created_at',
            ],
            order: [
              ['last_name', 'ASC'],
              ['first_name', 'ASC'],
              ['id', 'ASC'],
            ],
            offset,
            limit,
          });

          return users.map((user) => [
            user.first_name,
            user.last_name,
            text(user.email),
            text(user.phone),
            formatBoolean(user.is_active),
            formatDateTime(user.created_at),
          ]);
        },
      };
    },
  };
}

export const parentsExport = accountExport({
  dataset: ExportDataset.PARENTS,
  label: 'Parents / Guardians',
  fileBase: 'parents',
  role: UserRole.PARENT,
});

export const driversExport = accountExport({
  dataset: ExportDataset.DRIVERS,
  label: 'Drivers',
  fileBase: 'drivers',
  role: UserRole.DRIVER,
});

export const conductorsExport = accountExport({
  dataset: ExportDataset.CONDUCTORS,
  label: 'Conductors',
  fileBase: 'conductors',
  role: UserRole.CONDUCTOR,
});

export const studentGuardiansExport: ExportDefinition = {
  dataset: ExportDataset.STUDENT_GUARDIANS,
  label: 'Student ↔ guardian links',
  fileBase: 'student_guardians',
  supportedFilters: ['status', 'student_id', 'parent_id'],
  columns: [
    { header: 'Admission Number', width: 20 },
    { header: 'Student Name', width: 26 },
    { header: 'Guardian Name', width: 26 },
    { header: 'Guardian Email', width: 30 },
    { header: 'Guardian Phone', width: 18 },
    { header: 'Relationship', width: 18 },
    { header: 'Can Pick Up', width: 12 },
    { header: 'Primary Contact', width: 16 },
    { header: 'Active', width: 10 },
  ],

  async prepare(repositories, schoolId, query) {
    const where: Record<string, unknown> = {
      school_id: schoolId,
      ...activeClause(query.status),
    };
    if (query.student_id) {
      where.student_id = query.student_id;
    }
    if (query.parent_id) {
      where.user_id = query.parent_id;
    }

    const total = await repositories.guardians.count({ where: where as WhereOptions });

    return {
      total,
      async loadPage(offset, limit): Promise<SheetCell[][]> {
        const links = await repositories.guardians.findAll({
          where: where as WhereOptions,
          order: [
            ['created_at', 'ASC'],
            ['id', 'ASC'],
          ],
          offset,
          limit,
        });
        if (links.length === 0) {
          return [];
        }

        const students = await repositories.students.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(links.map((link) => link.student_id))] },
          },
          attributes: ['id', 'admission_number', 'first_name', 'last_name'],
        });
        const studentById = new Map(students.map((student) => [student.id, student]));

        const parents = await repositories.users.findAll({
          where: {
            school_id: schoolId,
            id: { [Op.in]: [...new Set(links.map((link) => link.user_id))] },
          },
          attributes: ['id', 'first_name', 'last_name', 'email', 'phone'],
        });
        const parentById = new Map(parents.map((parent) => [parent.id, parent]));

        return links.map((link) => {
          const student = studentById.get(link.student_id);
          const parent = parentById.get(link.user_id);
          return [
            text(student?.admission_number),
            student ? `${student.first_name} ${student.last_name}`.trim() : '',
            parent ? `${parent.first_name} ${parent.last_name}`.trim() : '',
            text(parent?.email),
            text(parent?.phone),
            link.relationship,
            formatBoolean(link.can_pick_up),
            formatBoolean(link.is_primary),
            formatBoolean(link.is_active),
          ];
        });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

/**
 * Resolves a `route_id` / `stop_id` filter into the stop ids to match.
 *
 * Returns `null` when neither filter is present, which the caller reads as
 * "do not constrain the home stop at all".
 */
async function resolveStopScope(
  repositories: ExportRepositories,
  schoolId: string,
  query: ExportQuery,
): Promise<string[] | null> {
  if (query.stop_id) {
    return [query.stop_id];
  }
  if (!query.route_id) {
    return null;
  }
  const stops = await repositories.stops.findAll({
    where: { school_id: schoolId, route_id: query.route_id },
    attributes: ['id'],
  });
  return stops.map((stop) => stop.id);
}

async function loadStops(
  repositories: ExportRepositories,
  schoolId: string,
  ids: Array<string | null>,
) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) {
    return new Map<string, { id: string; name: string; route_id: string }>();
  }
  const stops = await repositories.stops.findAll({
    where: { school_id: schoolId, id: { [Op.in]: unique } },
    attributes: ['id', 'name', 'route_id'],
  });
  return new Map(stops.map((stop) => [stop.id, stop]));
}

async function loadRoutes(
  repositories: ExportRepositories,
  schoolId: string,
  ids: Array<string | null>,
) {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (unique.length === 0) {
    return new Map<string, { id: string; code: string; name: string }>();
  }
  const routes = await repositories.routes.findAll({
    where: { school_id: schoolId, id: { [Op.in]: unique } },
    attributes: ['id', 'code', 'name'],
  });
  return new Map(routes.map((route) => [route.id, route]));
}

/**
 * Primary guardian of each student, falling back to the first active link.
 *
 * A roster spreadsheet needs one "who do I call" column, not a variable number
 * of guardian columns; the full many-to-many lives in its own dataset.
 */
async function loadPrimaryGuardians(
  repositories: ExportRepositories,
  schoolId: string,
  studentIds: string[],
) {
  if (studentIds.length === 0) {
    return new Map<
      string,
      { first_name: string; last_name: string; email: string | null; phone: string | null }
    >();
  }

  const links = await repositories.guardians.findAll({
    where: { school_id: schoolId, student_id: { [Op.in]: studentIds }, is_active: true },
    attributes: ['student_id', 'user_id', 'is_primary'],
    order: [
      ['is_primary', 'DESC'],
      ['created_at', 'ASC'],
    ],
  });

  const firstLinkByStudent = new Map<string, string>();
  for (const link of links) {
    if (!firstLinkByStudent.has(link.student_id)) {
      firstLinkByStudent.set(link.student_id, link.user_id);
    }
  }

  const parentIds = [...new Set(firstLinkByStudent.values())];
  if (parentIds.length === 0) {
    return new Map<
      string,
      { first_name: string; last_name: string; email: string | null; phone: string | null }
    >();
  }

  const parents = await repositories.users.findAll({
    where: { school_id: schoolId, id: { [Op.in]: parentIds } },
    attributes: ['id', 'first_name', 'last_name', 'email', 'phone'],
  });
  const parentById = new Map(parents.map((parent) => [parent.id, parent]));

  const result = new Map<
    string,
    { first_name: string; last_name: string; email: string | null; phone: string | null }
  >();
  for (const [studentId, parentId] of firstLinkByStudent) {
    const parent = parentById.get(parentId);
    if (parent) {
      result.set(studentId, {
        first_name: parent.first_name,
        last_name: parent.last_name,
        email: parent.email,
        phone: parent.phone,
      });
    }
  }
  return result;
}

/** Re-exported so the operations datasets can share the date helper. */
export { dateRangeClause };
