/**
 * Shared in-memory model stubs for the manual smoke diagnostics.
 *
 * Every `web/scripts/smoke/*.ts` script boots the real route runtime and the
 * real services without a database (`DB_AUTO_CONNECT=false
 * DB_ALLOW_NO_CONNECT=true`) and swaps each service's model dependencies for
 * in-memory tables. Keeping those fakes in one place means a service that
 * gains a constructor dependency or starts using `sequelize.fn()`/`group`
 * aggregates is fixed once, for every script — the drift that silently broke
 * four of these diagnostics (a new `runs` dependency and grouped COUNT
 * aggregates they never implemented) cannot come back unnoticed.
 *
 * The fakes are deliberately small and *Sequelize-shaped* rather than a query
 * engine: `findAll`/`findOne`/`count`/`findAndCountAll`/`create`/`update`,
 * equality + `Op.*` operands, `order`, `limit`/`offset`, `group` and
 * `COUNT`-style aggregates via `sequelize.fn(...)`. Anything they do not
 * support throws instead of returning a wrong answer, so a script can never
 * pass by accident.
 */
import { Op } from 'sequelize';

export interface Row {
  [key: string]: unknown;
}

/** Marker returned by the `sequelize.fn()` facade. */
export interface SqlAggregate {
  __smokeAggregate: string;
  __argument?: SqlColumn | string;
  /** Attribute alias, e.g. `'count'` in `[fn('COUNT', col('id')), 'count']`. */
  as?: string;
}

/** Marker returned by the `sequelize.col()` facade. */
export interface SqlColumn {
  __smokeColumn: string;
}

function isAggregate(value: unknown): value is SqlAggregate {
  return typeof value === 'object' && value !== null && '__smokeAggregate' in value;
}

function isColumn(value: unknown): value is SqlColumn {
  return typeof value === 'object' && value !== null && '__smokeColumn' in value;
}

/** True when the value is a Sequelize model class (i.e. a DB dependency). */
function isModelClass(value: unknown): boolean {
  return (
    typeof value === 'function' && typeof (value as { tableName?: unknown }).tableName === 'string'
  );
}

/** Compares one row value against one `where` operand (equality or `Op.*`). */
function operandMatches(value: unknown, expected: unknown): boolean {
  if (expected === null || expected === undefined) {
    return value === null || value === undefined;
  }

  if (typeof expected === 'object') {
    const ops = expected as Record<symbol | string, unknown>;
    const hasOperator =
      Object.getOwnPropertySymbols(ops).length > 0 || Op.or in ops || Op.and in ops;
    if (hasOperator) {
      if (Op.or in ops) {
        const list = ops[Op.or] as unknown[];
        if (!list.some((entry) => operandMatches(value, entry))) return false;
      }
      if (Op.and in ops) {
        const list = ops[Op.and] as unknown[];
        if (!list.every((entry) => operandMatches(value, entry))) return false;
      }
      if (Op.in in ops) {
        if (!(ops[Op.in] as unknown[]).includes(value)) return false;
      }
      if (Op.notIn in ops) {
        if ((ops[Op.notIn] as unknown[]).includes(value)) return false;
      }
      if (Op.ne in ops) {
        if (value === ops[Op.ne]) return false;
      }
      if (Op.gt in ops || Op.gte in ops || Op.lt in ops || Op.lte in ops) {
        const asNumber = (input: unknown): number =>
          input instanceof Date ? input.getTime() : new Date(String(input)).getTime();
        const current = asNumber(value);
        if (Op.gt in ops && !(current > asNumber(ops[Op.gt]))) return false;
        if (Op.gte in ops && !(current >= asNumber(ops[Op.gte]))) return false;
        if (Op.lt in ops && !(current < asNumber(ops[Op.lt]))) return false;
        if (Op.lte in ops && !(current <= asNumber(ops[Op.lte]))) return false;
      }
      return true;
    }
  }

  return value === expected;
}

/** Sequelize-shaped `where` matching (equality, `Op.in`, `Op.or`/`Op.and`, ranges). */
export function matchesWhere(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, expected]) => operandMatches(row[key], expected));
}

function applyAggregate(aggregate: SqlAggregate, rows: Row[]): number {
  const name = aggregate.__smokeAggregate.toUpperCase();
  if (name === 'COUNT') {
    // COUNT(col) counts non-null values, exactly like SQL.
    const column = aggregate.__argument;
    if (isColumn(column)) {
      return rows.filter(
        (row) => row[column.__smokeColumn] !== null && row[column.__smokeColumn] !== undefined,
      ).length;
    }
    return rows.length;
  }
  if (name === 'SUM' || name === 'MAX' || name === 'MIN' || name === 'AVG') {
    const column = isColumn(aggregate.__argument) ? aggregate.__argument.__smokeColumn : undefined;
    const values = rows.map((row) => Number(column ? row[column] : 0));
    if (values.length === 0) return 0;
    if (name === 'SUM') return values.reduce((total, value) => total + value, 0);
    if (name === 'MAX') return Math.max(...values);
    if (name === 'MIN') return Math.min(...values);
    return values.reduce((total, value) => total + value, 0) / values.length;
  }
  throw new Error(`smoke stub: unsupported aggregate ${aggregate.__smokeAggregate}`);
}

function sortRows(rows: Row[], order: unknown): Row[] {
  if (!Array.isArray(order) || order.length === 0) return rows;
  const [entry] = order as Array<[string, string] | string>;
  const field = Array.isArray(entry) ? entry[0] : entry;
  const direction = Array.isArray(entry) ? (entry[1] ?? 'ASC') : 'ASC';
  return [...rows].sort((a, b) => {
    const left = a[field];
    const right = b[field];
    const leftComparable = left instanceof Date ? left.getTime() : (left as never);
    const rightComparable = right instanceof Date ? right.getTime() : (right as never);
    if (leftComparable === rightComparable) return 0;
    const result = (leftComparable as never) > (rightComparable as never) ? 1 : -1;
    return direction.toUpperCase() === 'DESC' ? -result : result;
  });
}

export interface StubOptions {
  /** Field used when the stub has to mint an id (defaults to `id`). */
  idField?: string;
  /** Defaults applied to `create()` payloads, e.g. `{ is_active: true }`. */
  defaults?: Row;
  /** Table name used in error messages. */
  name?: string;
}

export interface StubTable {
  findAll(options?: Row): Promise<Row[]>;
  findOne(options?: Row): Promise<Row | null>;
  findAndCountAll(options?: Row): Promise<{ rows: Row[]; count: number }>;
  count(options?: Row): Promise<number>;
  max(field: string, options?: Row): Promise<number | null>;
  create(payload: Row): Promise<Row>;
  bulkCreate(payloads: Row[]): Promise<Row[]>;
  update(patch: Row, options?: Row): Promise<[number]>;
  destroy(options?: Row): Promise<number>;
  /** Services that bypass a default scope (`AuthService`) call `.unscoped()`. */
  unscoped(): StubTable;
  /** Sequelize instance facade — attached by {@link attachSequelize}. */
  sequelize?: SequelizeFacade;
  /** Every stored row, for assertions inside the scripts. */
  rows: Row[];
}

export interface SequelizeFacade {
  fn(name: string, argument?: SqlColumn | string): SqlAggregate;
  col(name: string): SqlColumn;
  literal(sql: string): { __smokeLiteral: string };
  and(...values: unknown[]): { [Op.and]: unknown[] };
  or(...values: unknown[]): { [Op.or]: unknown[] };
  query(sql: string): Promise<unknown[]>;
}

let idCounter = 0;

/**
 * Builds an in-memory table that answers the Sequelize calls the services make.
 * Aggregates need {@link attachSequelize} to have run, because `fn`/`col` live
 * on the sequelize instance the models are registered with.
 */
export function stubTable(list: Row[], options: StubOptions = {}): StubTable {
  const idField = options.idField ?? 'id';
  const label = options.name ?? 'table';

  const table: StubTable = {
    rows: list,

    async findAll(query: Row = {}) {
      let rows = list.filter((row) => matchesWhere(row, query.where as Row | undefined));
      rows = sortRows(rows, query.order);

      const attributes = query.attributes as unknown[] | undefined;
      const aggregates = (attributes ?? []).filter(isAggregate);
      const group = query.group as string[] | undefined;

      if (group && group.length > 0) {
        const buckets = new Map<string, Row[]>();
        for (const row of rows) {
          const key = group.map((column) => String(row[column])).join('\u0000');
          buckets.set(key, [...(buckets.get(key) ?? []), row]);
        }
        rows = [...buckets.values()].map((bucket) => {
          const output: Row = {};
          for (const column of group) output[column] = bucket[0][column];
          for (const aggregate of aggregates) {
            output[aggregate.as ?? 'count'] = applyAggregate(aggregate, bucket);
          }
          return output;
        });
      } else if (aggregates.length > 0) {
        const output: Row = {};
        for (const aggregate of aggregates) {
          output[aggregate.as ?? 'count'] = applyAggregate(aggregate, rows);
        }
        rows = [output];
      }

      const offset = typeof query.offset === 'number' ? query.offset : 0;
      const limit = typeof query.limit === 'number' ? query.limit : rows.length;
      return rows.slice(offset, offset + limit);
    },

    async findOne(query: Row = {}) {
      const rows = await table.findAll(query);
      return rows[0] ?? null;
    },

    async findAndCountAll(query: Row = {}) {
      const matching = list.filter((row) => matchesWhere(row, query.where as Row | undefined));
      const ordered = sortRows(matching, query.order);
      const offset = typeof query.offset === 'number' ? query.offset : 0;
      const limit = typeof query.limit === 'number' ? query.limit : ordered.length;
      return { rows: ordered.slice(offset, offset + limit), count: matching.length };
    },

    async count(query: Row = {}) {
      return list.filter((row) => matchesWhere(row, query.where as Row | undefined)).length;
    },

    async max(field: string, query: Row = {}) {
      const rows = list.filter((row) => matchesWhere(row, query.where as Row | undefined));
      if (rows.length === 0) return null;
      return Math.max(...rows.map((row) => Number(row[field])));
    },

    async create(payload: Row) {
      idCounter += 1;
      const timestamp = new Date();
      const row: Row = {
        [idField]: `${label}-${idCounter}`,
        ...options.defaults,
        ...payload,
        created_at: payload.created_at ?? timestamp,
        updated_at: payload.updated_at ?? timestamp,
      };
      row.save = async () => undefined;
      row.update = async (patch: Row) => Object.assign(row, patch);
      row.destroy = async () => {
        const index = list.indexOf(row);
        if (index >= 0) list.splice(index, 1);
      };
      list.push(row);
      return row;
    },

    async bulkCreate(payloads: Row[]) {
      const created: Row[] = [];
      for (const payload of payloads) created.push(await table.create(payload));
      return created;
    },

    async update(patch: Row, query: Row = {}) {
      const affected = list.filter((row) => matchesWhere(row, query.where as Row | undefined));
      for (const row of affected) Object.assign(row, patch, { updated_at: new Date() });
      return [affected.length] as [number];
    },

    async destroy(query: Row = {}) {
      const doomed = list.filter((row) => matchesWhere(row, query.where as Row | undefined));
      for (const row of doomed) {
        const index = list.indexOf(row);
        if (index >= 0) list.splice(index, 1);
      }
      return doomed.length;
    },

    unscoped() {
      return table;
    },
  };

  return table;
}

/**
 * Attaches one shared sequelize facade to every stub, so `model.sequelize.fn()`
 * / `col()` keep working exactly like they do against a real connection.
 */
export function attachSequelize(...tables: Array<StubTable | Row>): SequelizeFacade {
  const facade: SequelizeFacade = {
    fn: (name: string, argument?: SqlColumn | string) => ({
      __smokeAggregate: name,
      __argument: argument,
    }),
    col: (name: string) => ({ __smokeColumn: name }),
    literal: (sql: string) => ({ __smokeLiteral: sql }),
    and: (...values: unknown[]) => ({ [Op.and]: values }),
    or: (...values: unknown[]) => ({ [Op.or]: values }),
    async query(sql: string) {
      throw new Error(`smoke stub: raw sequelize.query() is not available (${sql.slice(0, 60)}…)`);
    },
  };

  for (const table of tables) {
    if (table && typeof table === 'object' && 'findAll' in table) {
      (table as StubTable).sequelize = facade;
    }
  }
  return facade;
}

/**
 * Guards against the drift that made `smoke:parent` / `smoke:eta` fail with an
 * opaque `Model not initialized: Member "findAll" cannot be called` 500: the
 * service had gained a **model** dependency the script never stubbed, and a
 * model without an attached Sequelize instance always throws in a DB-less run.
 *
 * - Unstubbed model classes (`Model.tableName` exists) are **fatal** — they
 *   cannot work without a real connection.
 * - Unstubbed sibling services are only **warned** about: the container
 *   usually wires ones that work without a database (JWT, config, audit), and
 *   stubbing those would just add noise.
 * - Non-dependency instance fields (`logger`, caches, counters) are ignored,
 *   and an explicit `key: undefined` marks a dependency as intentionally
 *   disabled.
 */
export function assertStubsCoverDependencies(
  service: object,
  stubs: Record<string, unknown>,
  label: string,
): { missingModels: string[]; unstubbedServices: string[] } {
  const missingModels: string[] = [];
  const unstubbedServices: string[] = [];

  for (const key of Object.keys(service)) {
    if (key in stubs) continue;
    const value = (service as Record<string, unknown>)[key];
    if (isModelClass(value)) {
      missingModels.push(key);
    } else if (
      typeof value === 'object' &&
      value !== null &&
      (value.constructor?.name ?? '').endsWith('Service')
    ) {
      unstubbedServices.push(key);
    }
  }

  if (missingModels.length > 0) {
    throw new Error(
      `${label}: missing stub(s) for model dependency ${missingModels.join(', ')} — the service ` +
        `gained a model this smoke script does not fake (see scripts/smoke/support/smoke-stubs.ts).`,
    );
  }
  if (unstubbedServices.length > 0) {
    console.warn(
      `  ! ${label}: dependency ${unstubbedServices.join(', ')} is not stubbed — the real instance ` +
        `from the container is used, which is fine as long as it needs no database.`,
    );
  }
  return { missingModels, unstubbedServices };
}
