import { Op, type Transaction } from 'sequelize';
import {
  ImportModule,
  PlanLimitResource,
  UserRole,
  type StudentGender,
} from '@school-bus-tracking/shared-types';
import { studentImportRowSchema, type StudentImportRow } from '@school-bus-tracking/validation';
import {
  IMPORT_INSERT_CHUNK_SIZE,
  chunk,
  issue,
  type ImportAcceptedRow,
  type ImportDefinition,
  type ImportPersistResult,
  type ImportRepositories,
  type ImportRowResolution,
  type PreparedImport,
} from '../import.types';

/**
 * Student roster import.
 *
 * The stop reference is expressed as `route_code` + `home_stop_name` rather
 * than a UUID: an admin filling a spreadsheet knows "NORTH-01 / Maple St", not
 * an internal id. Both are resolved against *this tenant's* routes and stops,
 * so a code belonging to another school simply does not resolve.
 *
 * The optional `parent_email` links an already-existing parent account to the
 * student. It deliberately does not *create* accounts — bulk account creation
 * has its own module (with password rules and plan limits), and silently
 * minting logins from a roster file would be a security surprise.
 */

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(`${value}T00:00:00.000Z`) : null;
}

export const studentsImportDefinition: ImportDefinition = {
  module: ImportModule.STUDENTS,
  label: 'Students',
  description:
    'One row per pupil. The home stop is matched by route code plus stop name; ' +
    'leave both blank if transport has not allocated a stop yet.',
  naturalKeyLabel: 'Admission number',
  maxRows: 5000,
  supportsUpsert: true,
  schema: studentImportRowSchema,
  columns: [
    {
      field: 'admission_number',
      header: 'Admission Number',
      required: true,
      description: 'Unique enrolment number inside your school.',
      example: 'ST001',
    },
    {
      field: 'first_name',
      header: 'First Name',
      required: true,
      description: "Pupil's given name.",
      example: 'Ahmed',
    },
    {
      field: 'last_name',
      header: 'Last Name',
      required: true,
      description: "Pupil's family name.",
      example: 'Khan',
    },
    {
      field: 'date_of_birth',
      header: 'Date Of Birth',
      required: false,
      description: 'Format YYYY-MM-DD.',
      example: '2016-03-15',
    },
    {
      field: 'gender',
      header: 'Gender',
      required: false,
      description: 'MALE, FEMALE or OTHER.',
      example: 'MALE',
      allowed_values: ['MALE', 'FEMALE', 'OTHER'],
    },
    {
      field: 'grade_level',
      header: 'Grade',
      required: false,
      description: 'Free text class label.',
      example: 'Grade 5',
    },
    {
      field: 'route_code',
      header: 'Route Code',
      required: false,
      description: 'Code of an existing route; required when a home stop is given.',
      example: 'NORTH-AM',
    },
    {
      field: 'home_stop_name',
      header: 'Home Stop',
      required: false,
      description: 'Name of an existing stop on that route.',
      example: 'Maple St & 5th Ave',
    },
    {
      field: 'emergency_contact_name',
      header: 'Emergency Contact Name',
      required: false,
      description: 'Contact used when no guardian is reachable.',
      example: 'Fatima Khan',
    },
    {
      field: 'emergency_contact_phone',
      header: 'Emergency Contact Phone',
      required: false,
      description: '7 to 15 digits; + ( ) - and spaces are allowed.',
      example: '+91 98765 43210',
    },
    {
      field: 'medical_notes',
      header: 'Medical Notes',
      required: false,
      description: 'Allergies, medication or mobility notes for the crew.',
      example: 'Peanut allergy',
    },
    {
      field: 'is_active',
      header: 'Active',
      required: false,
      description: 'TRUE or FALSE. Defaults to TRUE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
    {
      field: 'parent_email',
      header: 'Parent Email',
      required: false,
      description: 'Email of an existing parent account to link as guardian.',
      example: 'parent@example.com',
    },
    {
      field: 'parent_relationship',
      header: 'Parent Relationship',
      required: false,
      description: 'Mother, Father, Legal guardian… Required when Parent Email is filled.',
      example: 'Mother',
    },
  ],

  naturalKey(parsed) {
    return (parsed as StudentImportRow).admission_number.toLowerCase();
  },

  rowLabel(parsed) {
    const row = parsed as StudentImportRow;
    return `${row.first_name} ${row.last_name} (${row.admission_number})`;
  },

  async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
    const rows = parsedRows as StudentImportRow[];

    const routeCodes = unique(rows.map((row) => row.route_code));
    const admissionNumbers = unique(rows.map((row) => row.admission_number));
    const parentEmails = unique(rows.map((row) => row.parent_email));

    // Batch lookups — every one of them is pinned to the authenticated tenant.
    const [routes, existingStudents, parents] = await Promise.all([
      routeCodes.length
        ? repositories.routes.findAll({
            where: { school_id: schoolId, code: { [Op.in]: routeCodes } },
          })
        : Promise.resolve([]),
      admissionNumbers.length
        ? repositories.students.findAll({
            where: { school_id: schoolId, admission_number: { [Op.in]: admissionNumbers } },
          })
        : Promise.resolve([]),
      parentEmails.length
        ? repositories.users.findAll({
            where: {
              school_id: schoolId,
              role: UserRole.PARENT,
              email: { [Op.in]: parentEmails },
            },
          })
        : Promise.resolve([]),
    ]);

    const routeByCode = new Map(routes.map((route) => [route.code.toLowerCase(), route]));
    const studentByAdmission = new Map(
      existingStudents.map((student) => [student.admission_number.toLowerCase(), student]),
    );
    const parentByEmail = new Map(
      parents.map((parent) => [(parent.email ?? '').toLowerCase(), parent]),
    );

    const stops = routes.length
      ? await repositories.stops.findAll({
          where: { school_id: schoolId, route_id: { [Op.in]: routes.map((route) => route.id) } },
        })
      : [];
    const stopByRouteAndName = new Map(
      stops.map((stop) => [`${stop.route_id}::${stop.name.trim().toLowerCase()}`, stop]),
    );

    return {
      planResources: [PlanLimitResource.STUDENTS],

      resolve(parsed): ImportRowResolution {
        const row = parsed as StudentImportRow;
        const issues = [];

        let homeStopId: string | null = null;
        if (row.home_stop_name && !row.route_code) {
          issues.push(issue('Route Code', 'Route code is required when a home stop is given'));
        } else if (row.route_code) {
          const route = routeByCode.get(row.route_code.toLowerCase());
          if (!route) {
            issues.push(issue('Route Code', `Route "${row.route_code}" was not found`));
          } else if (row.home_stop_name) {
            const stop = stopByRouteAndName.get(
              `${route.id}::${row.home_stop_name.trim().toLowerCase()}`,
            );
            if (!stop) {
              issues.push(
                issue(
                  'Home Stop',
                  `Stop "${row.home_stop_name}" was not found on route ${row.route_code}`,
                ),
              );
            } else {
              homeStopId = stop.id;
            }
          }
        }

        let parentId: string | null = null;
        if (row.parent_email) {
          const parent = parentByEmail.get(row.parent_email);
          if (!parent) {
            issues.push(
              issue(
                'Parent Email',
                `No parent account exists for "${row.parent_email}". Import parents first.`,
              ),
            );
          } else {
            parentId = parent.id;
            if (!row.parent_relationship) {
              issues.push(
                issue(
                  'Parent Relationship',
                  'Parent relationship is required when linking a parent',
                ),
              );
            }
          }
        }

        const existing = studentByAdmission.get(row.admission_number.toLowerCase());

        if (issues.length > 0) {
          return { issues, existingId: existing?.id ?? null };
        }

        return {
          issues: [],
          existingId: existing?.id ?? null,
          payload: {
            admission_number: row.admission_number,
            first_name: row.first_name,
            last_name: row.last_name,
            date_of_birth: toDate(row.date_of_birth),
            gender: (row.gender ?? null) as StudentGender | null,
            grade_level: row.grade_level ?? null,
            home_stop_id: homeStopId,
            emergency_contact_name: row.emergency_contact_name ?? null,
            emergency_contact_phone: row.emergency_contact_phone ?? null,
            medical_notes: row.medical_notes ?? null,
            is_active: row.is_active ?? true,
            // Guardian linkage is applied after the students are written.
            __parent_id: parentId,
            __parent_relationship: row.parent_relationship ?? null,
          },
        };
      },

      async persist(
        accepted: ImportAcceptedRow[],
        transaction: Transaction,
      ): Promise<ImportPersistResult> {
        const inserts = accepted.filter((row) => !row.existingId);
        const updates = accepted.filter((row) => row.existingId);

        // `school_id` is forced here, never taken from the file.
        const createdIdByAdmission = new Map<string, string>();
        for (const page of chunk(inserts, IMPORT_INSERT_CHUNK_SIZE)) {
          const created = await repositories.students.bulkCreate(
            page.map((row) => ({
              school_id: schoolId,
              ...stripInternal(row.payload),
            })) as never,
            { transaction, validate: true, returning: true },
          );
          for (const student of created) {
            createdIdByAdmission.set(student.admission_number.toLowerCase(), student.id);
          }
        }

        for (const row of updates) {
          await repositories.students.update(stripInternal(row.payload) as never, {
            where: { id: row.existingId as string, school_id: schoolId },
            transaction,
            individualHooks: true,
          });
        }

        // Optional guardian links, once every student id is known.
        const guardianRows = accepted
          .map((row) => {
            const parentId = row.payload.__parent_id as string | null;
            if (!parentId) return null;
            const studentId =
              row.existingId ??
              createdIdByAdmission.get(String(row.payload.admission_number).toLowerCase()) ??
              null;
            if (!studentId) return null;
            return {
              school_id: schoolId,
              student_id: studentId,
              user_id: parentId,
              relationship: String(row.payload.__parent_relationship ?? 'Guardian'),
              can_pick_up: true,
              is_primary: false,
              is_active: true,
            };
          })
          .filter((row): row is NonNullable<typeof row> => row !== null);

        if (guardianRows.length > 0) {
          const existingLinks = await repositories.guardians.findAll({
            where: {
              school_id: schoolId,
              student_id: { [Op.in]: unique(guardianRows.map((row) => row.student_id)) },
            },
            transaction,
          });
          const linked = new Set(
            existingLinks.map((link) => `${link.student_id}::${link.user_id}`),
          );
          const newLinks = guardianRows.filter(
            (row) => !linked.has(`${row.student_id}::${row.user_id}`),
          );
          for (const page of chunk(newLinks, IMPORT_INSERT_CHUNK_SIZE)) {
            await repositories.guardians.bulkCreate(page as never, {
              transaction,
              validate: true,
            });
          }
        }

        return { created: inserts.length, updated: updates.length };
      },
    };
  },
};

/** Drops the `__`-prefixed staging keys before the payload reaches Sequelize. */
function stripInternal(payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (!key.startsWith('__')) {
      result[key] = value;
    }
  }
  return result;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
