/**
 * Dry-runs the four-dummy-schools seeder against an in-memory
 * `QueryInterface` stub.
 *
 * No database is required. Every row the seeder would write is captured and
 * then checked for the two properties the "Manage data" bug came down to:
 *
 * 1. every `id` (and every `*_id` reference) is a syntactically valid RFC 4122
 *    v4 UUID — the contract `BaseModel`'s `@IsUUID(4)`, the DTOs and
 *    `parseUuidParam()` all enforce, and which PostgreSQL's `uuid` type does
 *    *not*;
 * 2. every foreign key resolves to a row the same run inserts, so the graph is
 *    internally consistent.
 *
 * It also asserts the cleanup step purges the pre-fix ids, which is what lets
 * a plain `npm run db:seed` heal a database seeded before the fix.
 */
import type { QueryInterface } from 'sequelize';
import { isUuid } from '../../src/server/framework';
import {
  LEGACY_PLAN_IDS,
  PLAN_IDS,
  SCHOOL_CONFIGS,
  makeLegacyUuid,
  up,
} from '../../src/server/database/seeders/20260905120000-four-dummy-schools';

type Row = Record<string, unknown>;

const inserted = new Map<string, Row[]>();
const deletedByTable = new Map<string, Row[]>();
const rawQueries: Array<{ sql: string; replacements: Record<string, unknown> }> = [];

const queryInterface = {
  bulkInsert: async (table: string, rows: Row[]) => {
    inserted.set(table, [...(inserted.get(table) ?? []), ...rows]);
  },
  bulkDelete: async (table: string, where: Row) => {
    deletedByTable.set(table, [...(deletedByTable.get(table) ?? []), where]);
  },
  sequelize: {
    query: async (sql: string, options?: { replacements?: Record<string, unknown> }) => {
      rawQueries.push({ sql, replacements: options?.replacements ?? {} });
      return [[], 0];
    },
  },
} as unknown as QueryInterface;

/** Columns that are UUID references rather than free-form strings. */
const UUID_COLUMNS = /^(id|.*_id)$/;
/** Reference columns that are allowed to point outside this seeder's own rows. */
const EXTERNAL_REFS = new Set(['actor_user_id', 'acknowledged_by_user_id', 'resolved_by_user_id']);

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  // The seeder refuses to run against a production database; the npm script
  // pins NODE_ENV=test.
  await up(queryInterface);

  // ---- 1. cleanup covers both id schemes ----------------------------------
  const deletedSchoolIds = new Set(
    (deletedByTable.get('schools') ?? []).map((where) => String(where.id)),
  );
  for (const cfg of SCHOOL_CONFIGS) {
    if (!deletedSchoolIds.has(cfg.id)) fail(`cleanup misses current id of ${cfg.name}`);
    const legacyId = makeLegacyUuid(cfg.index, 1, 1);
    if (!deletedSchoolIds.has(legacyId)) fail(`cleanup misses pre-fix id of ${cfg.name}`);
  }
  console.log(`✔ cleanup purges ${deletedSchoolIds.size} school ids (4 current + 4 pre-fix)`);

  const planMoves = rawQueries.filter((entry) => entry.sql.includes('UPDATE "plans"'));
  if (planMoves.length !== Object.keys(PLAN_IDS).length) {
    fail(`expected ${Object.keys(PLAN_IDS).length} plan id migrations, got ${planMoves.length}`);
  }
  for (const move of planMoves) {
    const legacy = String(move.replacements.legacy);
    const next = String(move.replacements.next);
    if (!Object.values(LEGACY_PLAN_IDS).includes(legacy)) fail(`unexpected legacy plan ${legacy}`);
    if (!Object.values(PLAN_IDS).includes(next)) fail(`unexpected target plan ${next}`);
    if (!isUuid(next, '4')) fail(`plan is moved onto a non-v4 id: ${next}`);
  }
  console.log(`✔ ${planMoves.length} pre-fix plan ids are re-pointed (FK ON UPDATE CASCADE)`);

  // ---- 2. every written id is a valid v4 UUID -----------------------------
  const knownIds = new Set<string>();
  let rowCount = 0;
  for (const rows of inserted.values()) {
    for (const row of rows) {
      rowCount += 1;
      if (typeof row.id === 'string') knownIds.add(row.id);
    }
  }

  let checked = 0;
  for (const [table, rows] of inserted) {
    for (const row of rows) {
      for (const [column, value] of Object.entries(row)) {
        if (!UUID_COLUMNS.test(column) || typeof value !== 'string') continue;
        checked += 1;
        if (!isUuid(value, '4')) {
          fail(`${table}.${column} = ${value} is not a valid v4 UUID`);
        }
        if (column !== 'id' && !EXTERNAL_REFS.has(column) && !knownIds.has(value)) {
          fail(`${table}.${column} = ${value} references a row this seeder never inserts`);
        }
      }
    }
  }
  console.log(`✔ ${rowCount} rows across ${inserted.size} tables; ${checked} UUID columns valid`);
  console.log(`✔ every foreign key resolves inside the seeded graph`);

  // ---- 3. the four schools are exactly what the console will list ---------
  const schools = inserted.get('schools') ?? [];
  if (schools.length !== 4) fail(`expected 4 schools, got ${schools.length}`);
  for (const school of schools) {
    console.log(`  ${String(school.id)}  ${String(school.name)}`);
  }

  console.log('\n✅ seeder dry-run passed');
}

void main().catch((error) => {
  console.error('❌', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
