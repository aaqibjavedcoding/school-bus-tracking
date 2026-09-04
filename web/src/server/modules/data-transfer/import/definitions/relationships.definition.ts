import { Op } from 'sequelize';
import {
  ImportModule,
  ImportRowIssue,
  PlanLimitResource,
  RouteAssignmentRole,
  UserRole,
} from '@school-bus-tracking/shared-types';
import {
  routeAssignmentImportRowSchema,
  studentGuardianImportRowSchema,
  type RouteAssignmentImportRow,
  type StudentGuardianImportRow,
} from '@school-bus-tracking/validation';
import {
  findAssignmentConflict,
  type AssignmentCandidate,
} from '../../../assignments/assignment-conflicts';
import {
  IMPORT_INSERT_CHUNK_SIZE,
  chunk,
  issue,
  type ImportDefinition,
  type ImportPersistResult,
  type ImportRepositories,
  type ImportResolvedRow,
  type ImportRowResolution,
  type PreparedImport,
} from '../import.types';

/**
 * Relationship imports: student ↔ guardian links and crew rosters.
 *
 * Both join *existing* records by their business keys. Nothing here creates a
 * student, a user or a route — that keeps the blast radius of a mistyped
 * spreadsheet small, and it means a link file can be re-uploaded safely.
 */

export const studentGuardiansImportDefinition: ImportDefinition = {
  module: ImportModule.STUDENT_GUARDIANS,
  label: 'Student ↔ guardian links',
  description:
    'Connects existing pupils to existing parent accounts. Import students and ' +
    'parents first, then upload this file to wire them together.',
  naturalKeyLabel: 'Admission number + parent email',
  maxRows: 5000,
  supportsUpsert: true,
  schema: studentGuardianImportRowSchema,
  columns: [
    {
      field: 'admission_number',
      header: 'Admission Number',
      required: true,
      description: 'Admission number of an existing pupil.',
      example: 'ST001',
    },
    {
      field: 'parent_email',
      header: 'Parent Email',
      required: true,
      description: 'Email of an existing parent account in your school.',
      example: 'parent@example.com',
    },
    {
      field: 'relationship',
      header: 'Relationship',
      required: true,
      description: 'How the guardian relates to the pupil.',
      example: 'Mother',
    },
    {
      field: 'can_pick_up',
      header: 'Can Pick Up',
      required: false,
      description: 'TRUE if this guardian may collect the pupil. Defaults to TRUE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
    {
      field: 'is_primary',
      header: 'Primary Contact',
      required: false,
      description: 'TRUE for the first person to call. Defaults to FALSE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
  ],

  naturalKey(parsed) {
    const row = parsed as StudentGuardianImportRow;
    return `${row.admission_number.toLowerCase()}::${row.parent_email}`;
  },

  rowLabel(parsed) {
    const row = parsed as StudentGuardianImportRow;
    return `${row.admission_number} ↔ ${row.parent_email}`;
  },

  async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
    const rows = parsedRows as StudentGuardianImportRow[];
    const admissionNumbers = unique(rows.map((row) => row.admission_number));
    const emails = unique(rows.map((row) => row.parent_email));

    const [students, parents] = await Promise.all([
      admissionNumbers.length
        ? repositories.students.findAll({
            where: { school_id: schoolId, admission_number: { [Op.in]: admissionNumbers } },
          })
        : Promise.resolve([]),
      emails.length
        ? repositories.users.findAll({
            where: { school_id: schoolId, role: UserRole.PARENT, email: { [Op.in]: emails } },
          })
        : Promise.resolve([]),
    ]);

    const studentByAdmission = new Map(
      students.map((student) => [student.admission_number.toLowerCase(), student]),
    );
    const parentByEmail = new Map(
      parents.map((parent) => [(parent.email ?? '').toLowerCase(), parent]),
    );

    const existingLinks = students.length
      ? await repositories.guardians.findAll({
          where: {
            school_id: schoolId,
            student_id: { [Op.in]: students.map((student) => student.id) },
          },
        })
      : [];
    const linkByPair = new Map(
      existingLinks.map((link) => [`${link.student_id}::${link.user_id}`, link]),
    );

    return {
      planResources: [],

      resolve(parsed): ImportRowResolution {
        const row = parsed as StudentGuardianImportRow;
        const student = studentByAdmission.get(row.admission_number.toLowerCase());
        const parent = parentByEmail.get(row.parent_email);
        const issues = [];

        if (!student) {
          issues.push(
            issue('Admission Number', `No pupil with admission number "${row.admission_number}"`),
          );
        }
        if (!parent) {
          issues.push(issue('Parent Email', `No parent account exists for "${row.parent_email}"`));
        }
        if (issues.length > 0 || !student || !parent) {
          return { issues, existingId: null };
        }

        const existing = linkByPair.get(`${student.id}::${parent.id}`);

        return {
          issues: [],
          existingId: existing?.id ?? null,
          payload: {
            student_id: student.id,
            user_id: parent.id,
            relationship: row.relationship,
            can_pick_up: row.can_pick_up ?? true,
            is_primary: row.is_primary ?? false,
            is_active: true,
          },
        };
      },

      async persist(accepted, transaction): Promise<ImportPersistResult> {
        const inserts = accepted.filter((row) => !row.existingId);
        const updates = accepted.filter((row) => row.existingId);

        for (const page of chunk(inserts, IMPORT_INSERT_CHUNK_SIZE)) {
          await repositories.guardians.bulkCreate(
            page.map((row) => ({ school_id: schoolId, ...row.payload })) as never,
            { transaction, validate: true },
          );
        }

        for (const row of updates) {
          await repositories.guardians.update(row.payload as never, {
            where: { id: row.existingId as string, school_id: schoolId },
            transaction,
            individualHooks: true,
          });
        }

        return { created: inserts.length, updated: updates.length };
      },
    };
  },
};

export const routeAssignmentsImportDefinition: ImportDefinition = {
  module: ImportModule.ROUTE_ASSIGNMENTS,
  label: 'Route assignments',
  description:
    'Rosters existing drivers and conductors onto existing routes. One row per ' +
    'person per role; add the bus registration to pin a vehicle to the roster. ' +
    'The same person cannot cover two different routes with overlapping active periods.',
  naturalKeyLabel: 'Route code + crew email + role + effective from',
  maxRows: 5000,
  supportsUpsert: true,
  schema: routeAssignmentImportRowSchema,
  columns: [
    {
      field: 'route_code',
      header: 'Route Code',
      required: true,
      description: 'Code of an existing route.',
      example: 'NORTH-AM',
    },
    {
      field: 'user_email',
      header: 'Crew Email',
      required: true,
      description: 'Email of an existing driver or conductor account.',
      example: 'driver@example.com',
    },
    {
      field: 'role',
      header: 'Role',
      required: true,
      description: 'DRIVER or CONDUCTOR. Must match the account type.',
      example: 'DRIVER',
      allowed_values: ['DRIVER', 'CONDUCTOR'],
    },
    {
      field: 'bus_registration_number',
      header: 'Bus Registration Number',
      required: false,
      description: 'Registration of an existing bus, when the vehicle is fixed.',
      example: 'KA-01-AB-1234',
    },
    {
      field: 'effective_from',
      header: 'Effective From',
      required: true,
      description: 'First day the roster applies, as YYYY-MM-DD.',
      example: '2026-04-01',
    },
    {
      field: 'effective_to',
      header: 'Effective To',
      required: false,
      description: 'Last day (inclusive). Leave blank for an open-ended roster.',
      example: '2026-12-20',
    },
    {
      field: 'is_active',
      header: 'Active',
      required: false,
      description: 'TRUE or FALSE. Defaults to TRUE.',
      example: 'TRUE',
      allowed_values: ['TRUE', 'FALSE'],
    },
  ],

  naturalKey(parsed) {
    const row = parsed as RouteAssignmentImportRow;
    return `${row.route_code.toLowerCase()}::${row.user_email}::${row.role}::${row.effective_from}`;
  },

  rowLabel(parsed) {
    const row = parsed as RouteAssignmentImportRow;
    return `${row.user_email} → ${row.route_code} (${row.role})`;
  },

  async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
    const rows = parsedRows as RouteAssignmentImportRow[];
    const routeCodes = unique(rows.map((row) => row.route_code));
    const emails = unique(rows.map((row) => row.user_email));
    const registrations = unique(rows.map((row) => row.bus_registration_number));

    const [routes, crew, buses] = await Promise.all([
      routeCodes.length
        ? repositories.routes.findAll({
            where: { school_id: schoolId, code: { [Op.in]: routeCodes } },
          })
        : Promise.resolve([]),
      emails.length
        ? repositories.users.findAll({
            where: {
              school_id: schoolId,
              role: { [Op.in]: [UserRole.DRIVER, UserRole.CONDUCTOR] },
              email: { [Op.in]: emails },
            },
          })
        : Promise.resolve([]),
      registrations.length
        ? repositories.buses.findAll({
            where: { school_id: schoolId, registration_number: { [Op.in]: registrations } },
          })
        : Promise.resolve([]),
    ]);

    const routeByCode = new Map(routes.map((route) => [route.code.toLowerCase(), route]));
    const userByEmail = new Map(crew.map((user) => [(user.email ?? '').toLowerCase(), user]));
    const busByRegistration = new Map(
      buses.map((bus) => [bus.registration_number.toLowerCase(), bus]),
    );

    const routeIds = routes.map((route) => route.id);
    const userIds = crew.map((user) => user.id);
    const busIds = buses.map((bus) => bus.id);

    // Every assignment that this file could overlap with: rows on the file's
    // routes, rows already held by the file's crew members (they may be on
    // routes not present in the file), and rows already using the file's
    // buses. All are tenant-pinned to this school.
    const overlapScope: Array<Record<PropertyKey, unknown>> = [
      ...(routeIds.length ? [{ route_id: { [Op.in]: routeIds } }] : []),
      ...(userIds.length ? [{ user_id: { [Op.in]: userIds } }] : []),
      ...(busIds.length ? [{ bus_id: { [Op.in]: busIds } }] : []),
    ];
    const existingAssignments = overlapScope.length
      ? await repositories.assignments.findAll({
          where: { school_id: schoolId, [Op.or]: overlapScope },
        })
      : [];
    const assignmentByKey = new Map(
      existingAssignments.map((assignment) => [
        `${assignment.route_id}::${assignment.user_id}::${assignment.role}::${assignment.effective_from}`,
        assignment,
      ]),
    );

    return {
      planResources: [],

      resolve(parsed): ImportRowResolution {
        const row = parsed as RouteAssignmentImportRow;
        const issues = [];

        const route = routeByCode.get(row.route_code.toLowerCase());
        if (!route) {
          issues.push(issue('Route Code', `Route "${row.route_code}" was not found`));
        }

        const user = userByEmail.get(row.user_email);
        if (!user) {
          issues.push(
            issue('Crew Email', `No driver or conductor account exists for "${row.user_email}"`),
          );
        } else {
          // A conductor cannot be rostered as a driver: the roster role has to
          // agree with the account's role, same as the single-record endpoint.
          const expectedRole =
            row.role === RouteAssignmentRole.DRIVER ? UserRole.DRIVER : UserRole.CONDUCTOR;
          if (user.role !== expectedRole) {
            issues.push(
              issue(
                'Role',
                `"${row.user_email}" is a ${String(user.role).toLowerCase()} and cannot be rostered as ${row.role.toLowerCase()}`,
              ),
            );
          }
        }

        let busId: string | null = null;
        if (row.bus_registration_number) {
          const bus = busByRegistration.get(row.bus_registration_number.toLowerCase());
          if (!bus) {
            issues.push(
              issue(
                'Bus Registration Number',
                `Bus "${row.bus_registration_number}" was not found`,
              ),
            );
          } else {
            busId = bus.id;
          }
        }

        if (issues.length > 0 || !route || !user) {
          return { issues, existingId: null };
        }

        const key = `${route.id}::${user.id}::${row.role}::${row.effective_from}`;

        return {
          issues: [],
          existingId: assignmentByKey.get(key)?.id ?? null,
          payload: {
            route_id: route.id,
            user_id: user.id,
            bus_id: busId,
            role: row.role,
            effective_from: row.effective_from,
            effective_to: row.effective_to ?? null,
            is_active: row.is_active ?? true,
          },
        };
      },

      async batchIssues(rows: ImportResolvedRow[]): Promise<ReadonlyMap<string, ImportRowIssue[]>> {
        // Simulate the accepted writes in file order against the current
        // tenant roster. A row that would double-book a crew member, a bus or
        // a route role slot is reported and skipped; the conflict rules mirror
        // RouteAssignmentsService so a spreadsheet cannot bypass them.
        const roster = new Map<string, { id: string | null } & AssignmentCandidate>();
        for (const assignment of existingAssignments) {
          roster.set(assignment.id, {
            id: assignment.id,
            route_id: assignment.route_id,
            bus_id: assignment.bus_id,
            user_id: assignment.user_id,
            role: assignment.role,
            effective_from: assignment.effective_from,
            effective_to: assignment.effective_to ?? null,
            is_active: assignment.is_active,
          });
        }

        const issuesByKey = new Map<string, ImportRowIssue[]>();

        for (const resolved of rows) {
          const payload = resolved.payload as unknown as AssignmentCandidate;
          const id = resolved.existingId;
          const previous = id ? roster.get(id) : undefined;
          if (id) {
            // An upsert replaces its own current row; the other rows stay.
            roster.delete(id);
          }

          const conflict = findFirstRosterConflict(payload, roster);
          if (conflict) {
            issuesByKey.set(resolved.key, [{ column: null, message: conflict.message }]);
            if (previous) {
              roster.set(id as string, previous);
            }
            continue;
          }

          roster.set(id ?? `__file_row_${resolved.rowNumber}`, {
            id,
            route_id: payload.route_id,
            bus_id: payload.bus_id ?? null,
            user_id: payload.user_id,
            role: payload.role,
            effective_from: payload.effective_from,
            effective_to: payload.effective_to ?? null,
            is_active: payload.is_active ?? true,
          });
        }

        return issuesByKey;
      },

      async persist(accepted, transaction): Promise<ImportPersistResult> {
        const inserts = accepted.filter((row) => !row.existingId);
        const updates = accepted.filter((row) => row.existingId);

        for (const page of chunk(inserts, IMPORT_INSERT_CHUNK_SIZE)) {
          await repositories.assignments.bulkCreate(
            page.map((row) => ({ school_id: schoolId, ...row.payload })) as never,
            { transaction, validate: true },
          );
        }

        for (const row of updates) {
          await repositories.assignments.update(row.payload as never, {
            where: { id: row.existingId as string, school_id: schoolId },
            transaction,
            individualHooks: true,
          });
        }

        return { created: inserts.length, updated: updates.length };
      },
    };
  },
};

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** First active-overlap conflict between one candidate and a roster of rows. */
function findFirstRosterConflict(
  candidate: AssignmentCandidate,
  roster: ReadonlyMap<string, { id: string | null } & AssignmentCandidate>,
): { message: string } | null {
  for (const other of roster.values()) {
    const conflict = findAssignmentConflict(candidate, other);
    if (conflict) {
      return conflict;
    }
  }
  return null;
}

/** Plan limits do not meter relationships, only the entities they connect. */
export const RELATIONSHIP_PLAN_RESOURCES: PlanLimitResource[] = [];
