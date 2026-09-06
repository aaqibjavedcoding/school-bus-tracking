/**
 * Manual end-to-end verification of the "Manage data" entry point.
 *
 * Drives POST /api/v1/admin/schools/:schoolId/manage/session through the real
 * route runtime (CSRF → rate limit → JWT → roles → ManagedSchoolGuard →
 * handler → response envelope) with the *seeded* school ids, both before and
 * after the UUID fix.
 */
// Environment is supplied by the npm script (see `npm run smoke:manage-data`).
import { getContainer, overrideContainer } from '../../src/server/container';
import { invokeRoute } from '../../src/server/http/route-testing';
import type { EndpointDefinition } from '../../src/server/http/route-runtime';
import * as manage from '../../src/server/api/admin-manage';
import { School } from '../../src/server/database/models';
import { UserRole } from '@school-bus-tracking/shared-types';
import {
  SCHOOL_CONFIGS,
  makeLegacyUuid,
} from '../../src/server/database/seeders/20260905120000-four-dummy-schools';

const sessionStart =
  manage.postAdminSchoolsBySchoolIdManageSession as unknown as EndpointDefinition<never, never>;

const known = new Map(SCHOOL_CONFIGS.map((cfg) => [cfg.id, cfg]));
// Pretend the database also still holds the pre-fix rows, so the only thing
// that can reject them is validation — not a missing row.
for (const cfg of SCHOOL_CONFIGS) {
  const legacyId = makeLegacyUuid(cfg.index, 1, 1);
  known.set(legacyId, { ...cfg, id: legacyId });
}

// The guard resolves the school through the Sequelize model; stub the lookup
// so no database is required.
(School as unknown as { unscoped: () => unknown }).unscoped = () => ({
  findOne: async ({ where }: { where: { id: string } }) => {
    const match = known.get(where.id);
    return match ? { id: match.id, name: match.name, code: match.code, is_active: true } : null;
  },
});

const USER_ID = '22222222-2222-4222-8222-222222222222';

async function main(): Promise<void> {
  const c = getContainer();
  const token = await c
    .jwt()
    .signAsync({ sub: USER_ID, school_id: null, role: UserRole.SUPER_ADMIN });

  const restore = [
    overrideContainer('schoolAccess', {
      isSchoolAccessible: async () => true,
      isUserActive: async () => true,
    } as never),
    overrideContainer('assistedSession', {
      start: async (school: { id: string }) => ({
        id: '33333333-3333-4333-8333-333333333333',
        school_id: school.id,
        super_admin_user_id: USER_ID,
        started_at: new Date('2026-09-06T00:00:00.000Z'),
        ended_at: null,
        ip_address: null,
      }),
    } as never),
    overrideContainer('audit', { log: async () => undefined } as never),
  ];

  try {
    console.log('--- AFTER FIX: seeded school ids ------------------------------');
    for (const cfg of SCHOOL_CONFIGS) {
      const result = await invokeRoute(sessionStart, {
        method: 'POST',
        url: `http://localhost/api/v1/admin/schools/${cfg.id}/manage/session`,
        params: { schoolId: cfg.id },
        headers: { authorization: `Bearer ${token}` },
      });
      const body = result.body as {
        success?: boolean;
        data?: { school?: { name?: string } };
        error?: { message?: string };
      };
      console.log(
        `  ${cfg.id}  ->  ${result.status}  ${body.success ? `OK (${body.data?.school?.name})` : `FAIL (${body.error?.message})`}`,
      );
      if (result.status !== 201 || !body.success) {
        throw new Error(`expected 201 for ${cfg.name}`);
      }
    }

    console.log('\n--- BEFORE FIX: same schools, pre-fix ids ---------------------');
    for (const cfg of SCHOOL_CONFIGS) {
      const legacyId = makeLegacyUuid(cfg.index, 1, 1);
      const result = await invokeRoute(sessionStart, {
        method: 'POST',
        url: `http://localhost/api/v1/admin/schools/${legacyId}/manage/session`,
        params: { schoolId: legacyId },
        headers: { authorization: `Bearer ${token}` },
      });
      const body = result.body as { success?: boolean; error?: { message?: string } };
      console.log(`  ${legacyId}  ->  ${result.status}  ${body.error?.message ?? 'OK'}`);
      if (result.status !== 400) {
        throw new Error(`expected 400 for legacy id ${legacyId}`);
      }
    }

    console.log('\n--- Regression checks ----------------------------------------');
    const unknownSchool = '99999999-1111-4111-8111-111111111111';
    const notFound = await invokeRoute(sessionStart, {
      method: 'POST',
      url: `http://localhost/api/v1/admin/schools/${unknownSchool}/manage/session`,
      params: { schoolId: unknownSchool },
      headers: { authorization: `Bearer ${token}` },
    });
    console.log(`  unknown v4 school -> ${notFound.status} (expect 404)`);
    if (notFound.status !== 404) throw new Error('unknown school must still 404');

    const garbage = await invokeRoute(sessionStart, {
      method: 'POST',
      url: 'http://localhost/api/v1/admin/schools/not-a-uuid/manage/session',
      params: { schoolId: 'not-a-uuid' },
      headers: { authorization: `Bearer ${token}` },
    });
    console.log(`  malformed school  -> ${garbage.status} (expect 400)`);
    if (garbage.status !== 400) throw new Error('malformed id must still 400');

    const anonymous = await invokeRoute(sessionStart, {
      method: 'POST',
      url: `http://localhost/api/v1/admin/schools/${SCHOOL_CONFIGS[0].id}/manage/session`,
      params: { schoolId: SCHOOL_CONFIGS[0].id },
    });
    console.log(`  no token          -> ${anonymous.status} (expect 401)`);
    if (anonymous.status !== 401) throw new Error('anonymous must still 401');

    const schoolAdminToken = await c
      .jwt()
      .signAsync({ sub: USER_ID, school_id: SCHOOL_CONFIGS[0].id, role: UserRole.SCHOOL_ADMIN });
    const forbidden = await invokeRoute(sessionStart, {
      method: 'POST',
      url: `http://localhost/api/v1/admin/schools/${SCHOOL_CONFIGS[0].id}/manage/session`,
      params: { schoolId: SCHOOL_CONFIGS[0].id },
      headers: { authorization: `Bearer ${schoolAdminToken}` },
    });
    console.log(`  SCHOOL_ADMIN      -> ${forbidden.status} (expect 403)`);
    if (forbidden.status !== 403) throw new Error('school admin must still 403');

    console.log('\n✅ all checks passed');
  } finally {
    for (const undo of restore) undo();
  }
}

void main().catch((error) => {
  console.error('❌', error);
  process.exitCode = 1;
});
