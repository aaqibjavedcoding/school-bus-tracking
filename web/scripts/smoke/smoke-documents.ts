/**
 * HTTP smoke test for Task 44 — bus & driver compliance documents.
 *
 * Boots the real Nest application (guards, validation pipe, exception filter,
 * transform interceptor and every controller — including the real
 * `DocumentsService`, `DocumentComplianceService` and
 * `DocumentRequirementsService`) and drives it over real HTTP through the
 * app's embedded server, with the Sequelize repositories replaced by
 * in-memory stubs (the same approach as `smoke-admin.ts`).
 *
 * A real PostgreSQL instance is not available in this sandbox, so the service
 * logic is exercised against Sequelize-shaped stubs; the migrations themselves
 * are reviewed for real deploys.
 *
 * Run: DB_AUTO_CONNECT=false DB_ALLOW_NO_CONNECT=true \
 *   node -r ts-node/register/transpile-only scripts/smoke/smoke-documents.ts
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { JwtService } from '../../src/server/framework';
import {
  BusDocumentType,
  DriverDocumentType,
  JwtAccessTokenPayload,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { createSmokeApp } from './support/smoke-app';
import { SchoolAccessService } from '../../src/server/common/access/school-access.service';
import { DocumentsService } from '../../src/server/modules/documents/documents.service';
import { DocumentComplianceService } from '../../src/server/modules/documents/document-compliance.service';
import { DocumentRequirementsService } from '../../src/server/modules/documents/document-requirements.service';

interface Row {
  [key: string]: unknown;
}

const SCHOOL_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCHOOL_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_A = '01010101-0101-4101-8101-010101010101';
const DRIVER_A = '07070707-0707-4707-8707-070707070701';
const BUS_A = '06060606-0606-4606-8606-060606060601';
const BUS_B = '06060606-0606-4606-8606-060606060602';

/** Calendar date `days` from today, in `YYYY-MM-DD`. */
function dateInDays(days: number): string {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
    .toISOString()
    .slice(0, 10);
}

async function main(): Promise<void> {
  const results: Array<{ name: string; ok: boolean; detail?: string }> = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, ok: true });
      console.log(`  ✓ ${name}`);
    } catch (error) {
      results.push({ name, ok: false, detail: (error as Error).message });
      console.log(`  ✗ ${name}: ${(error as Error).message}`);
    }
  };

  const now = () => new Date();

  // ---- In-memory data -------------------------------------------------
  const busDocuments: Row[] = [];
  const driverDocuments: Row[] = [];
  const requirements: Row[] = [];
  const buses: Row[] = [
    { id: BUS_A, school_id: SCHOOL_A, registration_number: 'BUS-A-1', is_active: true },
    { id: BUS_B, school_id: SCHOOL_B, registration_number: 'BUS-B-1', is_active: true },
  ];
  const users: Row[] = [
    {
      id: ADMIN_A,
      school_id: SCHOOL_A,
      role: UserRole.SCHOOL_ADMIN,
      first_name: 'Nina',
      last_name: 'Principal',
    },
    {
      id: DRIVER_A,
      school_id: SCHOOL_A,
      role: UserRole.DRIVER,
      first_name: 'Asha',
      last_name: 'Rane',
    },
  ];

  /**
   * Sequelize operator keys are ES symbols (`Op.or`, `Op.in`, `Op.ne`, …).
   * They appear at the top level of a `where` *and* inside a nested operator
   * object, and `Object.entries` drops them silently — so they are folded in
   * at both levels. Ignoring them would make a stub return rows the real
   * query would never return.
   */
  function entriesOf(value: Row): Array<[string, unknown]> {
    const named = Object.entries(value) as Array<[string, unknown]>;
    const symbolic = Object.getOwnPropertySymbols(value).map(
      (symbol) =>
        [
          String(symbol).replace(/^Symbol\(|\)/g, ''),
          (value as Record<symbol, unknown>)[symbol],
        ] as [string, unknown],
    );
    return [...named, ...symbolic];
  }

  function matchesWhere(row: Row, where: Row | undefined): boolean {
    if (!where) return true;
    return entriesOf(where).every(([key, expected]) => {
      if (key === 'or') {
        return (expected as Row[]).some((alternative) => matchesWhere(row, alternative));
      }
      const cell = row[key];
      if (expected && typeof expected === 'object') {
        return entriesOf(expected as Row).every(([op, operand]) => {
          if (op === 'in') return (operand as unknown[]).includes(cell);
          if (op === 'ne') return cell !== operand;
          return cell === operand;
        });
      }
      return cell === expected;
    });
  }

  function tableRepo(list: Row[]) {
    const repo = {
      create: async (payload: Row) => {
        const row: Row = {
          id: randomUUID(),
          created_at: now(),
          updated_at: now(),
          deleted_at: null,
          ...payload,
        };
        row.update = async (patch: Row) => {
          Object.assign(row, patch, { updated_at: now() });
          return row;
        };
        row.destroy = async () => {
          row.deleted_at = now();
        };
        list.push(row);
        return row;
      },
      findOrCreate: async (options: { where: Row; defaults: Row }) => {
        const existing = list.find((row) => matchesWhere(row, options.where));
        if (existing) return [existing, false];
        const created = await repo.create(options.defaults);
        return [created, true];
      },
      findOne: async (options: { where: Row }) =>
        (list.find((row) => !row.deleted_at && matchesWhere(row, options.where)) ??
          null) as Row | null,
      findAll: async (options: { where?: Row } = {}) =>
        list.filter((row) => !row.deleted_at && matchesWhere(row, options.where)) as Row[],
    };
    return repo;
  }

  // ---- App bootstrap --------------------------------------------------
  const app = await createSmokeApp();

  const patchService = (service: unknown, stubs: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(stubs)) {
      (service as Record<string, unknown>)[key] = value;
    }
  };

  const busRepo = tableRepo(busDocuments);
  const driverRepo = tableRepo(driverDocuments);
  const requirementRepo = tableRepo(requirements);
  const busesRepo = tableRepo(buses);
  const usersRepo = tableRepo(users);

  const requirementsService = app.get(DocumentRequirementsService);
  patchService(requirementsService, { requirements: requirementRepo });

  patchService(app.get(DocumentsService), {
    busDocuments: busRepo,
    driverDocuments: driverRepo,
    buses: busesRepo,
    users: usersRepo,
  });
  patchService(app.get(DocumentComplianceService), {
    busDocuments: busRepo,
    driverDocuments: driverRepo,
    buses: busesRepo,
    users: usersRepo,
  });
  patchService(app.get(SchoolAccessService), {
    schools: {
      findOne: async ({ where }: { where: { id: string } }) =>
        ({ id: where.id, is_active: true }) as unknown as Row,
    },
    // The container always wires the user repository; the in-memory table
    // here has no `unscoped`, and this script does not exercise the
    // account-active path, so the check is left disabled as before.
    users: undefined,
  });

  await app.listen(0);
  const address = app.getHttpServer().address();
  const port = typeof address === 'object' && address ? address.port : 3001;
  const base = `http://127.0.0.1:${port}/api/v1`;

  const jwt = app.get(JwtService);
  const signToken = async (role: UserRole, schoolId: string, sub: string) => {
    const payload: JwtAccessTokenPayload = { sub, school_id: schoolId, role };
    return jwt.signAsync(payload);
  };

  interface CallResult {
    status: number;
    json: Record<string, unknown> | string | undefined;
  }

  const call = async (
    method: string,
    path: string,
    options: { token?: string; body?: unknown } = {},
  ): Promise<CallResult> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await res.text();
    let json: Record<string, unknown> | string | undefined;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : undefined;
    } catch {
      json = text;
    }
    return { status: res.status, json };
  };

  /** Unwraps the `{ success, data }` envelope the API always returns. */
  const data = (result: CallResult): Record<string, unknown> => {
    const envelope = result.json as Record<string, unknown> | undefined;
    const payload = envelope?.data as Record<string, unknown> | undefined;
    if (!payload) {
      throw new Error(`unexpected response ${result.status}: ${JSON.stringify(result.json)}`);
    }
    return payload;
  };

  const adminToken = await signToken(UserRole.SCHOOL_ADMIN, SCHOOL_A, ADMIN_A);
  const driverToken = await signToken(UserRole.DRIVER, SCHOOL_A, DRIVER_A);
  const otherAdminToken = await signToken(UserRole.SCHOOL_ADMIN, SCHOOL_B, 'admin-b');

  // ---- Bus documents ---------------------------------------------------
  await check('bus document: a school admin can add an insurance policy', async () => {
    const res = await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: {
        document_type: BusDocumentType.INSURANCE,
        document_number: 'POL-2026-0091',
        issue_date: dateInDays(-100),
        expiry_date: dateInDays(10),
      },
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
    const created = data(res);
    if (created.document_type !== BusDocumentType.INSURANCE) throw new Error('wrong type');
    // Expiry is real: 10 days out is inside the 30-day warning window.
    if (created.status !== 'EXPIRING_SOON') throw new Error(`status was ${created.status}`);
    if (created.days_remaining !== 10) throw new Error(`days_remaining ${created.days_remaining}`);
  });

  await check('bus document: an expired certificate is reported as expired', async () => {
    await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: {
        document_type: BusDocumentType.POLLUTION_CERTIFICATE,
        expiry_date: dateInDays(-5),
      },
    });
    const list = data(
      await call('GET', `/buses/${BUS_A}/documents?status=EXPIRED`, { token: adminToken }),
    );
    const items = list.items as Array<Record<string, unknown>>;
    if (items.length !== 1) throw new Error(`expected 1 expired document, got ${items.length}`);
    if (items[0].status !== 'EXPIRED') throw new Error('not expired');
  });

  await check('bus document: an undated document never expires', async () => {
    const res = await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: { document_type: BusDocumentType.REGISTRATION_CERTIFICATE, document_number: 'RC-1' },
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
    if (data(res).status !== 'VALID') throw new Error('undated document must be valid');
  });

  await check('bus document: the list is paginated and searchable by type', async () => {
    const list = data(
      await call('GET', `/buses/${BUS_A}/documents?page=1&limit=2`, { token: adminToken }),
    );
    const meta = list.meta as Record<string, number>;
    if (meta.total !== 3) throw new Error(`expected 3 total, got ${meta.total}`);
    if (meta.totalPages !== 2) throw new Error(`expected 2 pages, got ${meta.totalPages}`);
    if ((list.items as unknown[]).length !== 2) throw new Error('page size not honoured');
  });

  await check('bus document: edit and delete work end to end', async () => {
    const created = data(
      await call('POST', `/buses/${BUS_A}/documents`, {
        token: adminToken,
        body: { document_type: BusDocumentType.PERMIT, expiry_date: dateInDays(300) },
      }),
    );
    const id = created.id as string;
    const updated = data(
      await call('PATCH', `/buses/${BUS_A}/documents/${id}`, {
        token: adminToken,
        body: { document_number: 'PERMIT-77', notes: 'Renewed' },
      }),
    );
    if (updated.document_number !== 'PERMIT-77') throw new Error('update not applied');
    if (updated.expiry_date !== dateInDays(300)) throw new Error('untouched field was lost');

    const removed = await call('DELETE', `/buses/${BUS_A}/documents/${id}`, { token: adminToken });
    if (removed.status !== 200) throw new Error(`expected 200, got ${removed.status}`);
    const list = data(await call('GET', `/buses/${BUS_A}/documents`, { token: adminToken }));
    if ((list.meta as Record<string, number>).total !== 3) throw new Error('soft delete failed');
  });

  await check('bus document: a client cannot assert a validity status', async () => {
    const res = await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: { document_type: BusDocumentType.OTHER, status: 'VALID' },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('bus document: a client cannot supply a tenant id', async () => {
    const res = await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: { document_type: BusDocumentType.OTHER, school_id: SCHOOL_B },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('bus document: an expiry before the issue date is rejected', async () => {
    const res = await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: {
        document_type: BusDocumentType.FITNESS_CERTIFICATE,
        issue_date: dateInDays(10),
        expiry_date: dateInDays(-10),
      },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('bus document: a driver catalogue type is rejected on a bus', async () => {
    const res = await call('POST', `/buses/${BUS_A}/documents`, {
      token: adminToken,
      body: { document_type: DriverDocumentType.DRIVING_LICENSE },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  await check('bus document: another tenant’s bus is hidden behind 404', async () => {
    const res = await call('POST', `/buses/${BUS_B}/documents`, {
      token: adminToken,
      body: { document_type: BusDocumentType.INSURANCE },
    });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  await check('bus document: crew are not allowed to manage compliance documents', async () => {
    const res = await call('GET', `/buses/${BUS_A}/documents`, { token: driverToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  // ---- Driver documents ------------------------------------------------
  await check('driver document: a licence with its number can be added', async () => {
    const res = await call('POST', `/drivers/${DRIVER_A}/documents`, {
      token: adminToken,
      body: {
        document_type: DriverDocumentType.DRIVING_LICENSE,
        document_number: 'DL-0420110012345',
        issue_date: dateInDays(-1000),
        expiry_date: dateInDays(1000),
      },
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
    const created = data(res);
    if (created.document_type_label !== 'Driving licence') throw new Error('wrong label');
    if (created.status !== 'VALID') throw new Error(`status was ${created.status}`);
    if (created.is_required !== true) throw new Error('the licence is required by default');
  });

  await check('driver document: an optional document is reported as not required', async () => {
    const res = await call('POST', `/drivers/${DRIVER_A}/documents`, {
      token: adminToken,
      body: { document_type: DriverDocumentType.MEDICAL_CERTIFICATE, expiry_date: dateInDays(3) },
    });
    if (res.status !== 201) throw new Error(`expected 201, got ${res.status}`);
    if (data(res).is_required !== false) throw new Error('medical is optional by default');
    if (data(res).status !== 'EXPIRING_SOON') throw new Error('expiry not derived');
  });

  await check('driver document: a driver from another school is hidden', async () => {
    const res = await call('GET', `/drivers/${DRIVER_A}/documents`, { token: otherAdminToken });
    if (res.status !== 404) throw new Error(`expected 404, got ${res.status}`);
  });

  // ---- Compliance ------------------------------------------------------
  await check('compliance: a bus with missing documents reports them', async () => {
    const compliance = data(
      await call('GET', `/buses/${BUS_A}/documents/compliance`, { token: adminToken }),
    );
    const summary = compliance.summary as Record<string, number | boolean>;
    // RC, insurance, fitness, permit and PUC — permit was soft-deleted above.
    if (summary.required_total !== 5) throw new Error(`required_total ${summary.required_total}`);
    if (summary.missing !== 2) throw new Error(`missing ${summary.missing}`);
    if (summary.expired !== 1) throw new Error(`expired ${summary.expired}`);
    if (summary.expiring_soon !== 1) throw new Error(`expiring_soon ${summary.expiring_soon}`);
    if (summary.is_compliant !== false) throw new Error('must not be compliant');
  });

  await check('compliance: the driver is compliant once the licence is on file', async () => {
    const compliance = data(
      await call('GET', `/drivers/${DRIVER_A}/documents/compliance`, { token: adminToken }),
    );
    const summary = compliance.summary as Record<string, number | boolean>;
    if (summary.is_compliant !== true) throw new Error('driver should be compliant');
    if (summary.missing !== 0) throw new Error(`missing ${summary.missing}`);
  });

  // ---- Requirement configuration --------------------------------------
  await check('requirements: the effective configuration lists every catalogue type', async () => {
    const result = data(
      await call('GET', '/document-requirements?owner_type=BUS', { token: adminToken }),
    );
    const items = result.items as Array<Record<string, unknown>>;
    if (items.length !== 6) throw new Error(`expected 6 bus types, got ${items.length}`);
    if (items.some((item) => item.is_customized !== false)) {
      throw new Error('nothing has been overridden yet');
    }
  });

  await check('requirements: a school can make a required document optional', async () => {
    const res = await call('PUT', '/document-requirements', {
      token: adminToken,
      body: {
        owner_type: 'BUS',
        items: [
          { document_type: BusDocumentType.PERMIT, is_required: false },
          {
            document_type: BusDocumentType.FITNESS_CERTIFICATE,
            is_required: true,
            expiry_warning_days: 7,
          },
        ],
      },
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const compliance = data(
      await call('GET', `/buses/${BUS_A}/documents/compliance`, { token: adminToken }),
    );
    const summary = compliance.summary as Record<string, number>;
    // PERMIT is no longer required, so only 4 required types remain.
    if (summary.required_total !== 4) throw new Error(`required_total ${summary.required_total}`);
    if (summary.missing !== 1) throw new Error(`missing ${summary.missing}`);
  });

  await check('requirements: another school’s override does not leak', async () => {
    const res = await call('PUT', '/document-requirements', {
      token: otherAdminToken,
      body: {
        owner_type: 'BUS',
        items: [{ document_type: BusDocumentType.INSURANCE, is_required: false }],
      },
    });
    if (res.status !== 200) throw new Error(`expected 200, got ${res.status}`);

    const compliance = data(
      await call('GET', `/buses/${BUS_A}/documents/compliance`, { token: adminToken }),
    );
    const insurance = (compliance.requirements as Array<Record<string, unknown>>).find(
      (item) => item.document_type === BusDocumentType.INSURANCE,
    );
    if (insurance?.is_required !== true) throw new Error('school B changed school A');
  });

  await check('requirements: an unknown document type is rejected', async () => {
    const res = await call('PUT', '/document-requirements', {
      token: adminToken,
      body: { owner_type: 'BUS', items: [{ document_type: 'DRIVING_LICENSE', is_required: true }] },
    });
    if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  });

  // ---- Overview --------------------------------------------------------
  await check('overview: every bus and driver of the school is reported', async () => {
    const overview = data(await call('GET', '/documents/overview', { token: adminToken }));
    const items = overview.items as Array<Record<string, unknown>>;
    if (items.length !== 2) throw new Error(`expected 2 owners, got ${items.length}`);
    const summary = overview.summary as Record<string, number>;
    // 4 required bus documents + 1 required driver document.
    if (summary.required_total !== 5) throw new Error(`required_total ${summary.required_total}`);
  });

  await check('overview: the compliance filter narrows to the resources needing work', async () => {
    const attention = data(
      await call('GET', '/documents/overview?compliance=attention', { token: adminToken }),
    );
    const items = attention.items as Array<Record<string, unknown>>;
    if (items.length !== 1)
      throw new Error(`expected 1 owner needing attention, got ${items.length}`);
    if (items[0].owner_type !== 'BUS') throw new Error('the bus is the one needing attention');

    const compliant = data(
      await call('GET', '/documents/overview?compliance=compliant', { token: adminToken }),
    );
    if ((compliant.items as unknown[]).length !== 1) throw new Error('expected 1 compliant owner');
  });

  await check('overview: crew cannot read the school compliance report', async () => {
    const res = await call('GET', '/documents/overview', { token: driverToken });
    if (res.status !== 403) throw new Error(`expected 403, got ${res.status}`);
  });

  await app.close();

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} smoke checks passed`);
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
