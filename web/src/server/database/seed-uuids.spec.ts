import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import { isUuid, parseUuidParam, validateDto } from '../framework';
import { ManagedSchoolGuard } from '../modules/admin/manage/managed-school.guard';
import { Reflector } from '../framework';
import { makeGuardContext } from '../http/route-testing';
import * as manage from '../api/admin-manage';
import type { EndpointDefinition } from '../http/route-runtime';
import {
  AdminManageExportDatasetParamDto,
  AdminManageImportModuleParamDto,
  AdminManageReportParamDto,
} from '../modules/admin/manage/admin-manage.dto';
import { ExportDataset, ImportModule, ReportType } from '@school-bus-tracking/shared-types';
import {
  LEGACY_PLAN_IDS,
  PLAN_IDS,
  SCHOOL_CONFIGS,
  makeLegacyUuid,
  makeUuid,
} from './seeders/20260905120000-four-dummy-schools';

/**
 * Every primary key this platform persists is a v4 UUID: `BaseModel` declares
 * `@IsUUID(4)` on `id` with a `UUIDV4` default, the DTOs validate ids with
 * `@IsUUID('4')`/zod `.uuid()`, and the route handlers re-check path segments
 * with `parseUuidParam()`.
 *
 * PostgreSQL's `uuid` column type does *not* enforce that — it accepts any 32
 * hex digits — so a seeder can happily write ids the rest of the stack then
 * refuses. That is exactly how `00000000-0000-4000-0101-000000000001` (variant
 * nibble `0` instead of `8`–`b`) got into the four-dummy-schools seeder and
 * made Super Admin → Schools → "Manage data" fail with
 * `Validation failed (uuid is expected)`.
 *
 * These tests are the guard rail against reintroducing it.
 */
describe('seeded UUIDs', () => {
  it('generates RFC 4122 v4 ids for every (school, type, item) triple', () => {
    for (const schoolIdx of [0, 1, 2, 3, 4]) {
      for (const typeCode of [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 0x20, 21, 22,
      ]) {
        for (const itemIdx of [1, 2, 15, 52, 255, 4096]) {
          const id = makeUuid(schoolIdx, typeCode, itemIdx);
          assert.ok(
            isUuid(id, '4'),
            `makeUuid(${schoolIdx}, ${typeCode}, ${itemIdx}) = ${id} is not a valid v4 UUID`,
          );
        }
      }
    }
  });

  it('keeps generated ids unique per (school, type, item)', () => {
    const seen = new Set<string>();
    for (const schoolIdx of [0, 1, 2, 3, 4]) {
      for (const typeCode of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 21, 22, 0x20]) {
        for (let itemIdx = 1; itemIdx <= 60; itemIdx += 1) {
          const id = makeUuid(schoolIdx, typeCode, itemIdx);
          assert.equal(seen.has(id), false, `duplicate seed id ${id}`);
          seen.add(id);
        }
      }
    }
  });

  it('never collides with the older demo-core-domain-data seeder ids', () => {
    // That seeder owns `00000000-0000-4000-8000-0000000000..` upwards; this one
    // always sets the school/type discriminators in the two leading bytes of
    // the final group, and only uses school index 0 for the plan catalogue.
    const demoStyle = /^00000000-0000-4000-8000-0000[0-9a-f]{8}$/;
    for (const cfg of SCHOOL_CONFIGS) {
      assert.equal(demoStyle.test(cfg.id), false, `${cfg.id} overlaps the demo seeder range`);
    }
    for (const planId of Object.values(PLAN_IDS)) {
      assert.equal(demoStyle.test(planId), false, `${planId} overlaps the demo seeder range`);
    }
  });

  it('exposes the four school ids as valid v4 UUIDs', () => {
    assert.equal(SCHOOL_CONFIGS.length, 4);
    for (const cfg of SCHOOL_CONFIGS) {
      assert.ok(isUuid(cfg.id, '4'), `${cfg.name} has a non-v4 id: ${cfg.id}`);
      // The exact check `POST /admin/schools/:schoolId/manage/session` runs.
      assert.equal(parseUuidParam(cfg.id, '4'), cfg.id);
    }
  });

  it('exposes the plan catalogue ids as valid v4 UUIDs', () => {
    for (const [name, id] of Object.entries(PLAN_IDS)) {
      assert.ok(isUuid(id, '4'), `plan ${name} has a non-v4 id: ${id}`);
    }
  });

  it('still knows the pre-fix ids so a seeded database can be healed', () => {
    // The legacy helper must keep producing the *invalid* ids: it exists only
    // to locate and purge rows written before the fix.
    assert.equal(makeLegacyUuid(1, 1, 1), '00000000-0000-4000-0101-000000000001');
    assert.equal(isUuid(makeLegacyUuid(1, 1, 1), '4'), false);
    assert.equal(Object.keys(LEGACY_PLAN_IDS).length, Object.keys(PLAN_IDS).length);
    for (const key of Object.keys(PLAN_IDS) as Array<keyof typeof PLAN_IDS>) {
      assert.notEqual(LEGACY_PLAN_IDS[key], PLAN_IDS[key]);
    }
  });

  it('contains no hand-written non-v4 UUID literal in any seeder', () => {
    const dir = path.join(__dirname, 'seeders');
    const uuidLiteral = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      if (file.endsWith('.spec.ts')) continue;
      const source = readFileSync(path.join(dir, file), 'utf8');
      for (const literal of source.match(uuidLiteral) ?? []) {
        // `makeLegacyUuid`'s documented example is deliberately invalid.
        if (literal === '00000000-0000-4000-0101-000000000001') continue;
        assert.ok(isUuid(literal, '4'), `${file} hard-codes a non-v4 UUID: ${literal}`);
      }
    }
  });

  it('satisfies the `@IsUUID(4)` route-parameter DTOs of the managed surface', async () => {
    // Imports, exports and reports inside "Manage data" validate the whole
    // `@Param()` object against these DTOs, which pin version 4 explicitly.
    for (const cfg of SCHOOL_CONFIGS) {
      await validateDto(
        AdminManageImportModuleParamDto,
        { schoolId: cfg.id, module: ImportModule.STUDENTS },
        'param',
      );
      await validateDto(
        AdminManageExportDatasetParamDto,
        { schoolId: cfg.id, dataset: ExportDataset.STUDENTS },
        'param',
      );
      await validateDto(
        AdminManageReportParamDto,
        { schoolId: cfg.id, report: ReportType.ATTENDANCE },
        'param',
      );
    }
  });
});

/**
 * End-to-end check of the reported bug at the exact layer it surfaced: the
 * "Manage data" button issues `POST /admin/schools/:schoolId/manage/session`,
 * whose guard resolves the school and whose handler re-parses the segment.
 */
describe('Manage data entry point accepts the seeded school ids', () => {
  const reflector = new Reflector();
  const sessionStart = manage.postAdminSchoolsBySchoolIdManageSession as EndpointDefinition<
    never,
    never
  >;

  function guardFor(schools: typeof SCHOOL_CONFIGS) {
    return new ManagedSchoolGuard(reflector, {
      unscoped: () => ({
        findOne: async ({ where }: { where: { id: string } }) => {
          const match = schools.find((cfg) => cfg.id === where.id);
          return match
            ? { id: match.id, name: match.name, code: match.code, is_active: true }
            : null;
        },
      }),
    } as never);
  }

  it('passes the managed-school guard for every seeded school', async () => {
    const guard = guardFor(SCHOOL_CONFIGS);
    for (const cfg of SCHOOL_CONFIGS) {
      const request = { headers: {}, method: 'POST', params: { schoolId: cfg.id } };
      const context = makeGuardContext(sessionStart, request as unknown as Record<string, unknown>);
      assert.equal(await guard.canActivate(context), true, `${cfg.name} was rejected`);
      assert.deepEqual((request as { managedSchool?: { id: string } }).managedSchool?.id, cfg.id);
    }
  });

  it('would have rejected the pre-fix ids at the guard, with a clear message', async () => {
    const guard = guardFor(SCHOOL_CONFIGS);
    const legacyId = makeLegacyUuid(1, 1, 1);
    const context = makeGuardContext(sessionStart, {
      headers: {},
      method: 'POST',
      params: { schoolId: legacyId },
    } as unknown as Record<string, unknown>);

    await assert.rejects(
      guard.canActivate(context),
      (error: { status?: number; message?: string }) => {
        assert.equal(error.status, 400);
        // Not the opaque `Validation failed (uuid is expected)` the handler
        // used to raise after the school had already been loaded.
        assert.match(String(error.message), /School id must be a UUID/);
        return true;
      },
    );
  });
});
