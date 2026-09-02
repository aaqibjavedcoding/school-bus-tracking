import { Op, type Transaction } from 'sequelize';
import { ImportModule, PlanLimitResource, UserRole } from '@school-bus-tracking/shared-types';
import { parentImportRowSchema, type ParentImportRow } from '@school-bus-tracking/validation';
import { hashPassword } from '../../../../auth';
import {
  IMPORT_INSERT_CHUNK_SIZE,
  chunk,
  issue,
  type ImportAcceptedRow,
  type ImportColumnDefinition,
  type ImportDefinition,
  type ImportPersistResult,
  type ImportRepositories,
  type ImportRowResolution,
  type PreparedImport,
} from '../import.types';

/**
 * Account imports (parents, drivers, conductors).
 *
 * These three modules differ only by the fixed role they create, so one
 * factory produces all of them. The role is a server-owned constant per
 * module — it is never a column in the file, exactly like the single-record
 * `POST /parents` and `POST /drivers` endpoints.
 *
 * ## Why the row cap is lower here
 *
 * Every created account needs a bcrypt digest at cost factor 12 (~300 ms of
 * CPU each, by design). Hashing 5 000 of them would occupy the API for
 * minutes, so account imports are capped at 500 rows per file and the hashes
 * are computed in bounded parallel batches before the transaction opens —
 * a long transaction holding row locks would be far worse than a slightly
 * longer request.
 */

const ACCOUNT_IMPORT_MAX_ROWS = 500;

/** Concurrent bcrypt hashes. Enough to use the event loop, small enough to
 *  leave the API responsive to other requests while an import runs. */
const HASH_CONCURRENCY = 8;

interface AccountModuleConfig {
  module: ImportModule;
  label: string;
  role: UserRole.PARENT | UserRole.DRIVER | UserRole.CONDUCTOR;
  description: string;
  planResources: PlanLimitResource[];
}

const ACCOUNT_COLUMNS = [
  {
    field: 'first_name',
    header: 'First Name',
    required: true,
    description: 'Given name.',
    example: 'Sara',
  },
  {
    field: 'last_name',
    header: 'Last Name',
    required: true,
    description: 'Family name.',
    example: 'Khan',
  },
  {
    field: 'email',
    header: 'Email',
    required: true,
    description: 'Login email. Must be unique inside your school.',
    example: 'sara.khan@example.com',
  },
  {
    field: 'password',
    header: 'Password',
    required: true,
    description: 'Initial password, at least 8 characters. Stored only as a bcrypt hash.',
    example: 'ChangeMe2026',
    // Never retained: the raw cell is redacted before the run is recorded, so
    // it cannot reach import_jobs.errors or the downloadable error workbook.
    sensitive: true,
  },
  {
    field: 'phone',
    header: 'Phone',
    required: false,
    description: '7 to 15 digits; + ( ) - and spaces are allowed.',
    example: '+91 98765 43210',
  },
  {
    field: 'is_active',
    header: 'Active',
    required: false,
    description: 'TRUE or FALSE. Defaults to TRUE.',
    example: 'TRUE',
    allowed_values: ['TRUE', 'FALSE'],
  },
] satisfies ImportColumnDefinition[];

/** Hashes passwords with bounded concurrency so the event loop stays usable. */
async function hashAll(passwords: string[]): Promise<string[]> {
  const digests: string[] = new Array(passwords.length);
  for (let start = 0; start < passwords.length; start += HASH_CONCURRENCY) {
    const slice = passwords.slice(start, start + HASH_CONCURRENCY);
    const hashed = await Promise.all(slice.map((password) => hashPassword(password)));
    hashed.forEach((digest, index) => {
      digests[start + index] = digest;
    });
  }
  return digests;
}

export function createAccountImportDefinition(config: AccountModuleConfig): ImportDefinition {
  return {
    module: config.module,
    label: config.label,
    description: config.description,
    naturalKeyLabel: 'Email',
    maxRows: ACCOUNT_IMPORT_MAX_ROWS,
    supportsUpsert: true,
    schema: parentImportRowSchema,
    columns: ACCOUNT_COLUMNS.map((column) => ({ ...column })),

    naturalKey(parsed) {
      return (parsed as ParentImportRow).email.toLowerCase();
    },

    rowLabel(parsed) {
      const row = parsed as ParentImportRow;
      return `${row.first_name} ${row.last_name} (${row.email})`;
    },

    async prepare(repositories: ImportRepositories, schoolId, parsedRows): Promise<PreparedImport> {
      const rows = parsedRows as ParentImportRow[];
      const emails = [...new Set(rows.map((row) => row.email.toLowerCase()))];

      // Email uniqueness is tenant-scoped across *all* roles (the unique index
      // is `(school_id, email)`), so an existing driver blocks a parent row
      // with the same address — the same rule the single-record services apply.
      const existingUsers = emails.length
        ? await repositories.users.findAll({
            where: { school_id: schoolId, email: { [Op.in]: emails } },
          })
        : [];
      const userByEmail = new Map(
        existingUsers.map((user) => [(user.email ?? '').toLowerCase(), user]),
      );

      return {
        planResources: config.planResources,

        resolve(parsed): ImportRowResolution {
          const row = parsed as ParentImportRow;
          const existing = userByEmail.get(row.email);

          if (existing && existing.role !== config.role) {
            return {
              issues: [
                issue(
                  'Email',
                  `"${row.email}" already belongs to another user in this school and cannot be reused`,
                ),
              ],
              // Not an upsertable match: a role change is not an import concern.
              existingId: null,
            };
          }

          return {
            issues: [],
            existingId: existing?.id ?? null,
            payload: {
              first_name: row.first_name,
              last_name: row.last_name,
              email: row.email,
              phone: row.phone ?? null,
              is_active: row.is_active ?? true,
              // Kept out of the persisted payload until hashing; never logged.
              __password: row.password,
            },
          };
        },

        async persist(
          accepted: ImportAcceptedRow[],
          transaction: Transaction,
        ): Promise<ImportPersistResult> {
          const inserts = accepted.filter((row) => !row.existingId);
          const updates = accepted.filter((row) => row.existingId);

          const digests = await hashAll(inserts.map((row) => String(row.payload.__password)));

          const records = inserts.map((row, index) => ({
            school_id: schoolId,
            role: config.role,
            first_name: row.payload.first_name,
            last_name: row.payload.last_name,
            email: row.payload.email,
            password_hash: digests[index],
            email_verified_at: null,
            phone: row.payload.phone,
            is_active: row.payload.is_active,
          }));

          for (const page of chunk(records, IMPORT_INSERT_CHUNK_SIZE)) {
            await repositories.users.bulkCreate(page as never, {
              transaction,
              validate: true,
            });
          }

          // Upsert never rewrites a password: an import file must not be able
          // to silently reset an existing user's credentials.
          for (const row of updates) {
            await repositories.users.update(
              {
                first_name: row.payload.first_name,
                last_name: row.payload.last_name,
                phone: row.payload.phone,
                is_active: row.payload.is_active,
              } as never,
              {
                where: { id: row.existingId as string, school_id: schoolId, role: config.role },
                transaction,
                individualHooks: true,
              },
            );
          }

          return { created: inserts.length, updated: updates.length };
        },
      };
    },
  };
}

export const parentsImportDefinition = createAccountImportDefinition({
  module: ImportModule.PARENTS,
  label: 'Parents / Guardians',
  role: UserRole.PARENT,
  description:
    'One row per parent account. Accounts can sign in immediately with the ' +
    'supplied password; link them to pupils with the student roster or the ' +
    'student ↔ guardian import.',
  planResources: [PlanLimitResource.PARENTS],
});

export const driversImportDefinition = createAccountImportDefinition({
  module: ImportModule.DRIVERS,
  label: 'Drivers',
  role: UserRole.DRIVER,
  description: 'One row per driver account.',
  planResources: [PlanLimitResource.DRIVERS, PlanLimitResource.STAFF],
});

export const conductorsImportDefinition = createAccountImportDefinition({
  module: ImportModule.CONDUCTORS,
  label: 'Conductors',
  role: UserRole.CONDUCTOR,
  description: 'One row per conductor account.',
  planResources: [PlanLimitResource.CONDUCTORS, PlanLimitResource.STAFF],
});
