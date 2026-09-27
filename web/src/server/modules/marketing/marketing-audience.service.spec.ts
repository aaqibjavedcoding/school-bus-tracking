import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { MarketingRecipientSource, UserRole } from '@school-bus-tracking/shared-types';
import { maskMarketingEmail, MarketingAudienceService } from './marketing-audience.service';

/**
 * The audience builder decides **who a campaign emails** — its behaviour is
 * the privacy posture of the whole marketing feature. The stubs below emulate
 * the four repositories the service touches; each test arranges a small
 * school database state (Nagpur/other cities, active/inactive, valid/missing
 * emails, duplicate addresses, suppressed addresses, admin accounts) and
 * asserts on the computation the builder produces.
 */

const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '22222222-2222-4222-8222-222222222222';
const SCHOOL_C = '33333333-3333-4333-8333-333333333333';
const SCHOOL_D = '44444444-4444-4444-8444-444444444444';

interface SchoolRow {
  id: string;
  name: string;
  email: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  is_active: boolean;
  deleted_at?: Date | null;
}

interface SubscriptionRow {
  school_id: string;
  status: string;
}

interface UserRow {
  school_id: string;
  role: UserRole;
  is_active: boolean;
  email: string | null;
  first_name: string;
  last_name: string;
}

function makeRepositories(options: {
  schools: SchoolRow[];
  subscriptions?: SubscriptionRow[];
  users?: UserRow[];
  suppressed?: string[];
}) {
  const schoolRows = options.schools;
  const subscriptionRows = options.subscriptions ?? [];
  const userRows = options.users ?? [];
  const suppressed = new Set(options.suppressed ?? []);

  const schools = {
    findAll: async ({ where }: { where: Record<PropertyKey, unknown> }) => {
      // Emulate the conditions the service pushes down (is_active, country
      // IN, id IN / NOT IN) — the in-memory check mirrors what Postgres would
      // do for the same where clause. Cities/states/search are deliberately
      // NOT emulated: the service intentionally resolves those itself.
      return schoolRows
        .filter((row) => !row.deleted_at)
        .filter((row) => where.is_active === undefined || row.is_active === where.is_active)
        .filter((row) => {
          const idCondition = where.id as Record<PropertyKey, unknown> | undefined;
          if (!idCondition) {
            return true;
          }
          const inList = idCondition[Op.in] as string[] | undefined;
          if (Array.isArray(inList) && !inList.includes(row.id)) {
            return false;
          }
          const notInList = idCondition[Op.notIn] as string[] | undefined;
          if (Array.isArray(notInList) && notInList.includes(row.id)) {
            return false;
          }
          return true;
        })
        .filter((row) => {
          const countryCondition = where.country as Record<PropertyKey, unknown> | undefined;
          const countryIn = countryCondition?.[Op.in] as string[] | undefined;
          if (Array.isArray(countryIn) && !countryIn.includes(row.country ?? '')) {
            return false;
          }
          return true;
        })
        .filter((row) => {
          const orConditions = where[Op.or] as
            Array<Record<string, Record<PropertyKey, unknown>>> | undefined;
          if (!Array.isArray(orConditions)) {
            return true;
          }
          return orConditions.some((condition) => {
            const [column, matcher] = Object.entries(condition)[0];
            const pattern = (matcher[Op.iLike] as string).replace(/^%|%$/g, '');
            const value = String((row as unknown as Record<string, unknown>)[column] ?? '');
            return value.toLowerCase().includes(pattern.toLowerCase());
          });
        });
    },
  };

  const subscriptions = {
    findAll: async ({ where }: { where: Record<PropertyKey, unknown> }) => {
      const ids = (where.school_id as Record<PropertyKey, unknown>)[Op.in] as string[];
      return subscriptionRows.filter((row) => ids.includes(row.school_id));
    },
  };

  const users = {
    findAll: async ({ where }: { where: Record<PropertyKey, unknown> }) => {
      const ids = (where.school_id as Record<PropertyKey, unknown>)[Op.in] as string[];
      return userRows.filter(
        (row) =>
          ids.includes(row.school_id) &&
          row.role === where.role &&
          row.is_active === where.is_active,
      );
    },
  };

  const suppressions = {
    findAll: async ({ where }: { where: Record<PropertyKey, unknown> }) => {
      const emails = (where.normalized_email as Record<PropertyKey, unknown>)[Op.in] as string[];
      return emails
        .filter((email) => suppressed.has(email))
        .map((normalized_email) => ({ normalized_email }));
    },
  };

  return { schools, subscriptions, users, suppressions };
}

function makeService(options: Parameters<typeof makeRepositories>[0]) {
  const repos = makeRepositories(options);
  return {
    service: new MarketingAudienceService(
      repos.schools as never,
      repos.subscriptions as never,
      repos.users as never,
      repos.suppressions as never,
    ),
    repos,
  };
}

const NAGPUR_SCHOOLS: SchoolRow[] = [
  {
    id: SCHOOL_A,
    name: 'Nagpur Public School',
    email: 'Office@NagpurPublic.edu',
    city: 'Nagpur',
    state: 'Maharashtra',
    country: 'IN',
    is_active: true,
  },
  {
    id: SCHOOL_B,
    name: 'Blue Ridge Nagpur',
    email: '  Blue@RidgeNagpur.edu  ',
    city: '  NAGPUR  ',
    state: ' Maharashtra ',
    country: 'IN',
    is_active: true,
  },
  {
    id: SCHOOL_C,
    name: 'Pune High',
    email: 'office@punehigh.edu',
    city: 'Pune',
    state: 'Maharashtra',
    country: 'IN',
    is_active: true,
  },
];

describe('MarketingAudienceService — school filtering', () => {
  it('filters by city Nagpur', async () => {
    const { service } = makeService({ schools: NAGPUR_SCHOOLS });
    const computation = await service.computeAudience({ cities: ['Nagpur'] });
    assert.equal(computation.total_eligible_schools, 2);
    // Deterministic order: school id, then the school email before admin emails.
    assert.deepEqual(
      computation.recipients.map((recipient) => recipient.normalized_email),
      ['office@nagpurpublic.edu', 'blue@ridgenagpur.edu'],
    );
  });

  it('matches cities case-insensitively and normalizes whitespace on both sides', async () => {
    const { service } = makeService({ schools: NAGPUR_SCHOOLS });
    const computation = await service.computeAudience({ cities: ['  nagpur '] });
    assert.equal(computation.total_eligible_schools, 2);
    const storedDirty = await service.computeAudience({ cities: ['NAGPUR'] });
    assert.equal(storedDirty.total_eligible_schools, 2);
  });

  it('does not widen a city match into a substring match', async () => {
    const { service } = makeService({
      schools: [
        ...NAGPUR_SCHOOLS,
        {
          id: SCHOOL_D,
          name: 'Nagpurguy High',
          email: 'office@nagpurguy.edu',
          city: 'Nagpurguy',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
      ],
    });
    const computation = await service.computeAudience({ cities: ['Nagpur'] });
    assert.equal(computation.total_eligible_schools, 2, 'Nagpurguy must not match Nagpur');
  });

  it('includes only active schools by default and excludes deleted schools', async () => {
    const { service } = makeService({
      schools: [
        ...NAGPUR_SCHOOLS,
        {
          id: SCHOOL_D,
          name: 'Closed Nagpur School',
          email: 'office@closed.edu',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: false,
        },
      ],
    });
    const byDefault = await service.computeAudience({ cities: ['Nagpur'] });
    assert.equal(byDefault.total_eligible_schools, 2, 'inactive school excluded by default');
    assert.equal(byDefault.filter.active_only, true, 'the normalized filter records the default');

    const explicit = await service.computeAudience({ cities: ['Nagpur'], active_only: false });
    assert.equal(explicit.total_eligible_schools, 3, 'active_only=false includes inactive');
  });

  it('excludes schools without a valid email and counts them', async () => {
    const { service } = makeService({
      schools: [
        {
          id: SCHOOL_A,
          name: 'Has Email',
          email: 'office@has.edu',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
        {
          id: SCHOOL_B,
          name: 'No Email',
          email: null,
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
        {
          id: SCHOOL_C,
          name: 'Malformed Email',
          email: 'not-an-email',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
        {
          id: SCHOOL_D,
          name: 'Uppercase Valid',
          email: 'OFFICE@UPPER.EDU',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
      ],
    });
    const computation = await service.computeAudience({ cities: ['Nagpur'] });
    assert.equal(computation.total_eligible_schools, 4);
    assert.equal(computation.invalid_email_count, 2, 'missing + malformed counted');
    assert.equal(computation.final_recipient_count, 2);
    assert.deepEqual(
      computation.recipients.map((recipient) => recipient.normalized_email),
      ['office@has.edu', 'office@upper.edu'],
    );
  });

  it('filters by state/region, country and explicit school selection', async () => {
    const { service } = makeService({
      schools: [
        ...NAGPUR_SCHOOLS,
        {
          id: SCHOOL_D,
          name: 'Dubai Intl',
          email: 'office@dubai.example',
          city: 'Dubai',
          state: 'Dubai',
          country: 'AE',
          is_active: true,
        },
      ],
    });

    const byState = await service.computeAudience({ states: ['maharashtra'] });
    assert.equal(byState.total_eligible_schools, 3);

    const byCountry = await service.computeAudience({ countries: ['ae'] });
    assert.equal(byCountry.total_eligible_schools, 1);

    const included = await service.computeAudience({ include_school_ids: [SCHOOL_A, SCHOOL_C] });
    assert.equal(included.total_eligible_schools, 2);

    const excluded = await service.computeAudience({ exclude_school_ids: [SCHOOL_A] });
    assert.equal(excluded.total_eligible_schools, 3);
  });

  it('filters by the current subscription status', async () => {
    const { service } = makeService({
      schools: NAGPUR_SCHOOLS,
      subscriptions: [
        { school_id: SCHOOL_A, status: 'trialing' },
        { school_id: SCHOOL_B, status: 'active' },
      ],
    });
    const trialing = await service.computeAudience({ subscription_statuses: ['trialing'] });
    assert.equal(trialing.total_eligible_schools, 1);
    assert.equal(trialing.final_recipient_count, 1);

    const both = await service.computeAudience({
      subscription_statuses: ['trialing', 'active'],
    });
    assert.equal(both.total_eligible_schools, 2);
  });

  it('supports the search dimension over school name/code/email', async () => {
    const { service } = makeService({
      schools: [
        ...NAGPUR_SCHOOLS,
        {
          id: SCHOOL_D,
          name: 'Other School',
          email: 'contact@other.edu',
          city: 'Pune',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
      ],
    });
    const computation = await service.computeAudience({ search: 'nagpur' });
    assert.equal(computation.total_eligible_schools, 2);
  });
});

describe('MarketingAudienceService — recipient resolution', () => {
  it('uses the school primary email by default and never parent/driver/conductor accounts', async () => {
    const { service } = makeService({
      schools: NAGPUR_SCHOOLS,
      users: [
        {
          school_id: SCHOOL_A,
          role: UserRole.SCHOOL_ADMIN,
          is_active: true,
          email: 'admin@nagpurpublic.edu',
          first_name: 'Ada',
          last_name: 'Admin',
        },
        {
          school_id: SCHOOL_A,
          role: UserRole.PARENT,
          is_active: true,
          email: 'parent@nagpurpublic.edu',
          first_name: 'Pat',
          last_name: 'Parent',
        },
        {
          school_id: SCHOOL_A,
          role: UserRole.DRIVER,
          is_active: true,
          email: 'driver@nagpurpublic.edu',
          first_name: 'Dee',
          last_name: 'Driver',
        },
      ],
    });
    const computation = await service.computeAudience({});
    assert.deepEqual(
      computation.recipients.map((recipient) => recipient.recipient_source),
      [
        MarketingRecipientSource.SCHOOL_EMAIL,
        MarketingRecipientSource.SCHOOL_EMAIL,
        MarketingRecipientSource.SCHOOL_EMAIL,
      ],
    );
    assert.ok(
      computation.recipients.every((recipient) => !recipient.normalized_email.includes('parent')),
      'parents are never recipients',
    );
  });

  it('includes active SCHOOL_ADMIN addresses only when explicitly selected', async () => {
    const { service } = makeService({
      schools: [NAGPUR_SCHOOLS[0]],
      users: [
        {
          school_id: SCHOOL_A,
          role: UserRole.SCHOOL_ADMIN,
          is_active: true,
          email: 'Ada@NagpurPublic.edu',
          first_name: 'Ada',
          last_name: 'Admin',
        },
        {
          school_id: SCHOOL_A,
          role: UserRole.SCHOOL_ADMIN,
          is_active: false,
          email: 'exadmin@nagpurpublic.edu',
          first_name: 'Ex',
          last_name: 'Admin',
        },
      ],
    });

    const byDefault = await service.computeAudience({});
    assert.deepEqual(
      byDefault.recipients.map((recipient) => recipient.recipient_source),
      [MarketingRecipientSource.SCHOOL_EMAIL],
    );

    const withAdmins = await service.computeAudience({
      recipient_sources: [
        MarketingRecipientSource.SCHOOL_EMAIL,
        MarketingRecipientSource.SCHOOL_ADMIN,
      ],
    });
    assert.equal(withAdmins.final_recipient_count, 2);
    const admin = withAdmins.recipients.find(
      (recipient) => recipient.recipient_source === MarketingRecipientSource.SCHOOL_ADMIN,
    );
    assert.equal(admin?.normalized_email, 'ada@nagpurpublic.edu');
    assert.equal(admin?.recipient_name, 'Ada Admin');
    assert.equal(
      withAdmins.recipients.find((r) => r.normalized_email === 'exadmin@nagpurpublic.edu'),
      undefined,
      'inactive admins are never included',
    );
  });

  it('excludes suppressed addresses and counts them', async () => {
    const { service } = makeService({
      schools: NAGPUR_SCHOOLS,
      suppressed: ['office@nagpurpublic.edu'],
    });
    const computation = await service.computeAudience({ cities: ['Nagpur'] });
    assert.equal(computation.suppressed_recipient_count, 1);
    assert.equal(computation.final_recipient_count, 1);
    assert.deepEqual(
      computation.recipients.map((recipient) => recipient.normalized_email),
      ['blue@ridgenagpur.edu'],
    );
  });

  it('deduplicates normalized addresses across schools and sources', async () => {
    const { service } = makeService({
      schools: [
        {
          id: SCHOOL_A,
          name: 'Alpha',
          email: 'Shared@Schools.edu',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
        {
          id: SCHOOL_B,
          name: 'Beta',
          email: 'shared@schools.edu',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
      ],
      users: [
        {
          school_id: SCHOOL_A,
          role: UserRole.SCHOOL_ADMIN,
          is_active: true,
          email: 'shared@schools.edu',
          first_name: 'Same',
          last_name: 'Person',
        },
      ],
    });
    const computation = await service.computeAudience({
      recipient_sources: [
        MarketingRecipientSource.SCHOOL_EMAIL,
        MarketingRecipientSource.SCHOOL_ADMIN,
      ],
    });
    assert.equal(computation.duplicate_recipient_count, 2, 'two duplicates removed');
    assert.equal(computation.final_recipient_count, 1);
    assert.equal(computation.recipients[0].school_id, SCHOOL_A);
  });

  it('normalizes whitespace and casing before deduplication', async () => {
    const { service } = makeService({
      schools: [
        {
          id: SCHOOL_A,
          name: 'Alpha',
          email: '  OFFICE@Alpha.EDU ',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
        {
          id: SCHOOL_B,
          name: 'Beta',
          email: 'office@alpha.edu',
          city: 'Nagpur',
          state: 'MH',
          country: 'IN',
          is_active: true,
        },
      ],
    });
    const computation = await service.computeAudience({});
    assert.equal(computation.duplicate_recipient_count, 1);
    assert.equal(computation.final_recipient_count, 1);
  });
});

describe('MarketingAudienceService — snapshot hash and preview', () => {
  it('generates a deterministic SHA-256 hash independent of school order', async () => {
    const { service } = makeService({ schools: NAGPUR_SCHOOLS });
    const first = await service.computeAudience({ cities: ['Nagpur'] });
    const second = await service.computeAudience({ cities: ['Nagpur'] });
    assert.match(first.snapshot_hash, /^[a-f0-9]{64}$/);
    assert.equal(first.snapshot_hash, second.snapshot_hash);

    // Same audience described by a different (equivalent) filter → same hash.
    const reordered = await service.computeAudience({ cities: ['nagpur'], active_only: true });
    assert.equal(reordered.snapshot_hash, first.snapshot_hash);

    // A different audience → a different hash.
    const wider = await service.computeAudience({});
    assert.notEqual(wider.snapshot_hash, first.snapshot_hash);
  });

  it('changes the hash when one recipient is added', async () => {
    const { service } = makeService({ schools: NAGPUR_SCHOOLS });
    const two = await service.computeAudience({ cities: ['Nagpur'] });
    const three = await service.computeAudience({});
    assert.notEqual(two.snapshot_hash, three.snapshot_hash);
  });

  it('previews with counts, a masked sample and no raw addresses', async () => {
    const { service } = makeService({
      schools: NAGPUR_SCHOOLS,
      suppressed: ['blue@ridgenagpur.edu'],
      users: [
        {
          school_id: SCHOOL_A,
          role: UserRole.SCHOOL_ADMIN,
          is_active: true,
          email: 'principal@nagpurpublic.edu',
          first_name: 'Priya',
          last_name: 'Principal',
        },
      ],
    });
    const preview = await service.preview({
      cities: ['Nagpur'],
      recipient_sources: [
        MarketingRecipientSource.SCHOOL_EMAIL,
        MarketingRecipientSource.SCHOOL_ADMIN,
      ],
    });

    assert.equal(preview.total_eligible_schools, 2);
    assert.equal(preview.final_recipient_count, 2);
    assert.equal(preview.suppressed_recipient_count, 1);
    assert.equal(preview.sample.length, 2);
    // The local part is masked; the institutional domain may stay (it is not
    // personal data, and it lets the operator sanity-check the audience).
    assert.ok(preview.sample.every((entry) => entry.masked_email.includes('*')));
    assert.ok(
      preview.sample.every((entry) => !(entry.masked_email.split('@')[1] ?? '').includes('*')),
      'only the local part is masked',
    );
    for (const entry of preview.sample) {
      assert.ok(!entry.masked_email.includes('office@nagpurpublic.edu'));
      assert.ok(!entry.masked_email.includes('principal@nagpurpublic.edu'));
    }
    assert.match(preview.snapshot_hash, /^[a-f0-9]{64}$/);
    // The normalized filter is echoed back for the console to display.
    assert.equal(preview.filter.active_only, true);
    assert.deepEqual(preview.filter.cities, ['Nagpur']);
  });

  it('masks addresses without revealing the local part', () => {
    assert.equal(maskMarketingEmail('principal@lincoln.edu'), 'p*******@lincoln.edu');
    assert.equal(maskMarketingEmail('a@b.io'), 'a*@b.io');
    assert.equal(maskMarketingEmail('not-an-address'), '***');
  });
});
