import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  marketingCampaignAudienceFilterSchema,
  marketingDemoLeadInputSchema,
  marketingEmailSchema,
  marketingTemplateSlugSchema,
  marketingTemplateVariableSchema,
  marketingTemplateVariablesSchema,
} from '@school-bus-tracking/validation';

/**
 * The marketing shared contracts (`packages/validation`), exercised the way
 * the Phase 2+ endpoints will use them. These schemas are the boundary
 * between the browser and the marketing tables: what they reject never
 * reaches a service, so their behaviour *is* the security posture of the
 * public surfaces (demo form) and the guard rails of the Super Admin ones
 * (audience filter).
 */

describe('marketingEmailSchema', () => {
  it('normalizes to trimmed lowercase', () => {
    assert.equal(
      marketingEmailSchema.parse('  Principal@School.EXAMPLE  '),
      'principal@school.example',
    );
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['not-an-email', '@example.com', 'a@b', 'a b@example.com', '']) {
      assert.equal(marketingEmailSchema.safeParse(bad).success, false, bad);
    }
  });
});

describe('marketingTemplateSlugSchema', () => {
  it('accepts and normalizes kebab-case slugs', () => {
    assert.equal(marketingTemplateSlugSchema.parse(' Welcome-Email '), 'welcome-email');
    assert.equal(marketingTemplateSlugSchema.parse('spring-promo-2027'), 'spring-promo-2027');
  });

  it('rejects anything that is not lowercase kebab-case', () => {
    for (const bad of ['Welcome Email', 'welcome_email', '-welcome', 'welcome-', 'a'.repeat(81)]) {
      assert.equal(marketingTemplateSlugSchema.safeParse(bad).success, false, bad);
    }
  });
});

describe('marketingTemplateVariableSchema / variablesSchema', () => {
  it('accepts a well-formed variable contract', () => {
    const parsed = marketingTemplateVariablesSchema.parse([
      {
        name: 'school_name',
        required: true,
        description: 'The school display name',
        example: 'Lincoln High',
      },
      { name: 'recipient_name', required: false },
    ]);
    assert.equal(parsed.length, 2);
  });

  it('rejects variable names that are not valid placeholder keys', () => {
    for (const name of ['School Name', '1school', 'school-name', 'SCHOOL_NAME', '']) {
      assert.equal(
        marketingTemplateVariableSchema.safeParse({ name, required: true }).success,
        false,
        name,
      );
    }
  });

  it('bounds the declared variable set', () => {
    const many = Array.from({ length: 51 }, (_, i) => ({ name: `v${i}`, required: false }));
    assert.equal(marketingTemplateVariablesSchema.safeParse(many).success, false);
  });
});

describe('marketingCampaignAudienceFilterSchema', () => {
  it('accepts a full, valid filter and normalizes countries', () => {
    const parsed = marketingCampaignAudienceFilterSchema.parse({
      search: 'lincoln',
      countries: ['in', 'GB'],
      cities: ['Mumbai'],
      subscription_statuses: ['trialing', 'active'],
      include_school_ids: ['00000000-0000-4000-8000-000000000001'],
      exclude_school_ids: ['00000000-0000-4000-8000-000000000002'],
      active_only: true,
    });
    assert.deepEqual(parsed.countries, ['IN', 'GB']);
  });

  it('rejects unknown keys — a stale client cannot smuggle a filter dimension', () => {
    assert.equal(
      marketingCampaignAudienceFilterSchema.safeParse({ tenant: 'evil' }).success,
      false,
    );
  });

  it('rejects invalid subscription statuses', () => {
    // `none` is the projection-only status — never a persisted filter value.
    assert.equal(
      marketingCampaignAudienceFilterSchema.safeParse({ subscription_statuses: ['none'] }).success,
      false,
    );
  });

  it('rejects include/exclude overlap', () => {
    const id = '00000000-0000-4000-8000-000000000003';
    const result = marketingCampaignAudienceFilterSchema.safeParse({
      include_school_ids: [id],
      exclude_school_ids: [id],
    });
    assert.equal(result.success, false);
  });

  it('bounds every array so a filter can never encode an unbounded query', () => {
    const countries = Array.from({ length: 101 }, () => 'IN');
    assert.equal(marketingCampaignAudienceFilterSchema.safeParse({ countries }).success, false);
  });

  it('rejects non-UUID school ids', () => {
    assert.equal(
      marketingCampaignAudienceFilterSchema.safeParse({ include_school_ids: ['not-a-uuid'] })
        .success,
      false,
    );
  });
});

describe('marketingDemoLeadInputSchema — the public demo form boundary', () => {
  const validInput = {
    full_name: 'Priya Sharma',
    email: 'Priya@Lincoln.EDU',
    institution_name: 'Lincoln High School',
    phone: '+91 98200 00000',
    city: 'Mumbai',
    country: 'in',
    message: 'We run 12 buses and need live tracking.',
    preferred_contact_time: 'Weekday mornings',
    utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'spring-2027' },
    consent: true,
  };

  it('accepts a complete submission and normalizes email and country', () => {
    const parsed = marketingDemoLeadInputSchema.parse(validInput);
    assert.equal(parsed.email, 'priya@lincoln.edu');
    assert.equal(parsed.country, 'IN');
  });

  it('requires explicit consent — false or missing is a rejection, not a warning', () => {
    assert.equal(
      marketingDemoLeadInputSchema.safeParse({ ...validInput, consent: false }).success,
      false,
    );
    const { consent: _omitted, ...withoutConsent } = validInput;
    assert.equal(marketingDemoLeadInputSchema.safeParse(withoutConsent).success, false);
  });

  it('requires the identity fields', () => {
    for (const field of ['full_name', 'email', 'institution_name']) {
      const rest: Record<string, unknown> = { ...validInput };
      delete rest[field];
      assert.equal(marketingDemoLeadInputSchema.safeParse(rest).success, false, field);
    }
  });

  it('rejects unknown keys — the public endpoint accepts nothing it did not ask for', () => {
    assert.equal(
      marketingDemoLeadInputSchema.safeParse({ ...validInput, role: 'SUPER_ADMIN' }).success,
      false,
    );
  });

  it('bounds the message length', () => {
    assert.equal(
      marketingDemoLeadInputSchema.safeParse({ ...validInput, message: 'x'.repeat(2001) }).success,
      false,
    );
    // And allows the maximum.
    assert.equal(
      marketingDemoLeadInputSchema.safeParse({ ...validInput, message: 'x'.repeat(2000) }).success,
      true,
    );
  });

  it('rejects a phone that is not a phone', () => {
    assert.equal(
      marketingDemoLeadInputSchema.safeParse({ ...validInput, phone: 'call me maybe' }).success,
      false,
    );
  });

  it('rejects utm payloads with unexpected dimensions', () => {
    assert.equal(
      marketingDemoLeadInputSchema.safeParse({
        ...validInput,
        utm: { utm_mischief: 'x' },
      }).success,
      false,
    );
  });
});
