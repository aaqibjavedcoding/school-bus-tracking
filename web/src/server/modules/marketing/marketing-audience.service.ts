/**
 * Server-side school audience resolution and recipient snapshot building.
 *
 * This is the only code in the system that decides **who a campaign emails**.
 * Two invariants drive its shape:
 *
 * 1. **The browser never supplies recipients.** The audience filter names
 *    *dimensions* (city, status, school ids to include/exclude, address
 *    sources); every address is resolved from database rows. The client
 *    cannot smuggle an address list, and school ids it does send are only
 *    ever used to narrow a query against the `schools` table.
 * 2. **The snapshot is a fact, not a query.** `computeAudience` returns a
 *    fully ordered, deduplicated, suppressed-excluded recipient list plus a
 *    SHA-256 digest of its canonical form — exactly what the schedule
 *    endpoint materializes inside a transaction.
 *
 * Defaults (all overridable by the filter, all enforced here rather than
 * trusted from the client):
 *
 * - active schools only (`is_active = true`); soft-deleted schools are always
 *   excluded by the model's paranoid scope;
 * - the school's **primary contact address** (`schools.email`) as the
 *   recipient; `SCHOOL_ADMIN` addresses are added only when the filter
 *   explicitly selects that source, and then only from **active** SCHOOL_ADMIN
 *   accounts — parents, drivers and conductors are never selectable;
 * - addresses are trimmed + lowercased, shape-checked, deduplicated, and
 *   removed when suppressed (`marketing_suppressions`).
 *
 * ### Matching semantics
 *
 * City and state/region matching is exact-but-normalized on **both** sides
 * (trim, collapse internal whitespace, case-insensitive) rather than a
 * database `ILIKE`: an exact match cannot be widened by a substring, and a
 * stored `  Nagpur ` still matches `nagpur`. Search, country, activity and
 * include/exclude are pushed down to the database; subscription status is
 * resolved from the school's latest subscription row.
 */

import { createHash } from 'node:crypto';
import { Op, type WhereOptions } from 'sequelize';
import { MarketingRecipientSource, UserRole } from '@school-bus-tracking/shared-types';
import type {
  MarketingAudienceMaskedRecipient,
  MarketingAudiencePreviewResponse,
  MarketingCampaignAudienceFilter,
} from '@school-bus-tracking/shared-types';
import { School, SchoolSubscription, User, MarketingSuppression } from '../../database/models';
import {
  MARKETING_AUDIENCE_SAMPLE_SIZE,
  MARKETING_DEFAULT_RECIPIENT_SOURCES,
  MARKETING_EMAIL_PATTERN,
} from './marketing.constants';

/** One resolved recipient of a campaign snapshot. */
export interface MarketingAudienceRecipient {
  school_id: string | null;
  /**
   * School name *as it is right now*. Copied into the snapshot so the
   * rendered message shows the name the campaign was approved against, even
   * if the school is renamed before the worker reaches this row.
   */
  school_name: string | null;
  normalized_email: string;
  recipient_name: string | null;
  recipient_source: MarketingRecipientSource;
}

/** The full, ordered answer to an audience filter. */
export interface MarketingAudienceComputation {
  /** The normalized filter these numbers were computed from. */
  filter: MarketingCampaignAudienceFilter;
  /** Schools matching every filter dimension. */
  total_eligible_schools: number;
  /** Eligible schools whose candidate address was missing or malformed. */
  invalid_email_count: number;
  /** Unique candidate addresses removed because they are suppressed. */
  suppressed_recipient_count: number;
  /** Candidate addresses removed by deduplication. */
  duplicate_recipient_count: number;
  /** `recipients.length`. */
  final_recipient_count: number;
  /** Deterministically ordered recipient list (see `computeAudience`). */
  recipients: MarketingAudienceRecipient[];
  /** SHA-256 hex digest of the canonicalized recipient list. */
  snapshot_hash: string;
}

/** Minimal school projection the builder works with. */
interface SchoolCandidate {
  id: string;
  name: string;
  email: string | null;
  city: string | null;
  state: string | null;
}

/** Minimal admin projection. */
interface AdminCandidate {
  school_id: string;
  email: string | null;
  first_name: string;
  last_name: string;
}

/** Normalizes one side of a city/state comparison. */
function normalizePlace(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalizes an address: trim + lowercase (the stored form). */
export function normalizeMarketingEmail(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().toLowerCase();
  if (normalized.length === 0 || normalized.length > 254) {
    return null;
  }
  return normalized;
}

/** Shape-checks a normalized address. */
export function isValidMarketingEmail(normalized: string | null): boolean {
  return normalized !== null && MARKETING_EMAIL_PATTERN.test(normalized);
}

/** Masks an address for the preview sample: `principal@lincoln.edu` → `p*******@lincoln.edu`. */
export function maskMarketingEmail(email: string): string {
  const separator = email.indexOf('@');
  if (separator <= 0) {
    return '***';
  }
  const local = email.slice(0, separator);
  const domain = email.slice(separator);
  const asterisks = '*'.repeat(Math.min(Math.max(local.length - 1, 1), 7));
  return `${local.slice(0, 1)}${asterisks}${domain}`;
}

/**
 * Canonicalizes + digests a recipient list.
 *
 * Entries are sorted by `(normalized_email, school_id)` and serialized with
 * explicit separators, so the digest depends only on the recipient *set*
 * (never on query order, timestamps or ids minted along the way). Two
 * campaigns that resolved the same audience get the same hash — that is the
 * whole point of `audience_snapshot_hash`.
 */
export function computeMarketingAudienceSnapshotHash(
  recipients: readonly MarketingAudienceRecipient[],
): string {
  const canonical = recipients
    .map((recipient) =>
      [
        recipient.normalized_email,
        recipient.school_id ?? '',
        recipient.recipient_name ?? '',
        recipient.recipient_source,
      ].join('\u0001'),
    )
    .sort()
    .join('\u0002');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Escapes SQL LIKE wildcards in a search term (the admin-plans convention). */
function escapeLikePattern(value: string): string {
  return value.replace(/[%_\\]/g, (char) => `\\${char}`);
}

export class MarketingAudienceService {
  constructor(
    private readonly schools: typeof School,
    private readonly subscriptions: typeof SchoolSubscription,
    private readonly users: typeof User,
    private readonly suppressions: typeof MarketingSuppression,
  ) {}

  /**
   * Resolves the audience filter against the schools tables.
   *
   * The result is ordered deterministically: schools by id, and within a
   * school `SCHOOL_EMAIL` before `SCHOOL_ADMIN` (then by address), so the
   * same database state always yields byte-identical output.
   */
  async computeAudience(
    filter: MarketingCampaignAudienceFilter,
  ): Promise<MarketingAudienceComputation> {
    const activeOnly = filter.active_only ?? true;
    const countries = [...new Set((filter.countries ?? []).map((value) => value.toUpperCase()))];
    const cities = new Set((filter.cities ?? []).map(normalizePlace).filter(Boolean));
    const states = new Set((filter.states ?? []).map(normalizePlace).filter(Boolean));
    const includeSchoolIds = [...new Set(filter.include_school_ids ?? [])];
    const excludeSchoolIds = [...new Set(filter.exclude_school_ids ?? [])];
    const sources = (filter.recipient_sources ?? [...MARKETING_DEFAULT_RECIPIENT_SOURCES]).slice();
    const wantsSchoolEmail = sources.includes(MarketingRecipientSource.SCHOOL_EMAIL);
    const wantsSchoolAdmin = sources.includes(MarketingRecipientSource.SCHOOL_ADMIN);

    const normalizedFilter: MarketingCampaignAudienceFilter = {
      ...(filter.search ? { search: filter.search } : {}),
      ...(countries.length > 0 ? { countries } : {}),
      ...(filter.cities ? { cities: filter.cities } : {}),
      ...(filter.states ? { states: filter.states } : {}),
      ...(filter.subscription_statuses
        ? { subscription_statuses: filter.subscription_statuses }
        : {}),
      ...(includeSchoolIds.length > 0 ? { include_school_ids: includeSchoolIds } : {}),
      ...(excludeSchoolIds.length > 0 ? { exclude_school_ids: excludeSchoolIds } : {}),
      active_only: activeOnly,
      recipient_sources: sources,
    };

    // ---- Step 1: candidate schools (dimensions safely pushed down). ----
    const where: Record<PropertyKey, unknown> = {};
    if (activeOnly) {
      where.is_active = true;
    }
    if (countries.length > 0) {
      where.country = { [Op.in]: countries };
    }
    if (includeSchoolIds.length > 0) {
      where.id = { [Op.in]: includeSchoolIds };
    }
    if (excludeSchoolIds.length > 0) {
      const existing = (where.id as Record<PropertyKey, unknown> | undefined) ?? {};
      where.id = { ...existing, [Op.notIn]: excludeSchoolIds };
    }
    const search = filter.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { name: { [Op.iLike]: pattern } },
        { code: { [Op.iLike]: pattern } },
        { email: { [Op.iLike]: pattern } },
      ];
    }

    const schoolRows = (await this.schools.findAll({
      where: where as WhereOptions,
      attributes: ['id', 'name', 'email', 'city', 'state'],
    })) as unknown as SchoolCandidate[];

    // ---- Step 2: in-memory exact-but-normalized city/state matching. ----
    const cityOrStateFiltered = schoolRows.filter((school) => {
      if (cities.size > 0 && !cities.has(normalizePlace(school.city))) {
        return false;
      }
      if (states.size > 0 && !states.has(normalizePlace(school.state))) {
        return false;
      }
      return true;
    });

    // ---- Step 3: subscription-status matching (latest row per school). ----
    let eligible = cityOrStateFiltered;
    const subscriptionStatuses = new Set(filter.subscription_statuses ?? []);
    if (subscriptionStatuses.size > 0) {
      const subscriptionRows = (await this.subscriptions.findAll({
        where: { school_id: { [Op.in]: cityOrStateFiltered.map((school) => school.id) } },
        order: [['created_at', 'DESC']],
        attributes: ['school_id', 'status'],
      })) as unknown as Array<{ school_id: string; status: string }>;
      const latestBySchool = new Map<string, string>();
      for (const row of subscriptionRows) {
        if (!latestBySchool.has(row.school_id)) {
          latestBySchool.set(row.school_id, row.status);
        }
      }
      eligible = cityOrStateFiltered.filter((school) => {
        const status = latestBySchool.get(school.id);
        return status !== undefined && subscriptionStatuses.has(status);
      });
    }

    eligible = eligible.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    // ---- Step 4: resolve candidate addresses per school. ----
    let invalidEmailCount = 0;
    const candidates: MarketingAudienceRecipient[] = [];

    if (wantsSchoolAdmin && eligible.length > 0) {
      const adminRows = (await this.users.findAll({
        where: {
          school_id: { [Op.in]: eligible.map((school) => school.id) },
          role: UserRole.SCHOOL_ADMIN,
          is_active: true,
        },
        attributes: ['school_id', 'email', 'first_name', 'last_name'],
      })) as unknown as AdminCandidate[];
      const adminsBySchool = new Map<string, AdminCandidate[]>();
      for (const admin of adminRows
        .slice()
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? ''))) {
        const list = adminsBySchool.get(admin.school_id) ?? [];
        list.push(admin);
        adminsBySchool.set(admin.school_id, list);
      }
      for (const school of eligible) {
        for (const admin of adminsBySchool.get(school.id) ?? []) {
          const normalized = normalizeMarketingEmail(admin.email);
          if (!isValidMarketingEmail(normalized)) {
            invalidEmailCount += 1;
            continue;
          }
          candidates.push({
            school_id: school.id,
            school_name: school.name || null,
            normalized_email: normalized as string,
            recipient_name: `${admin.first_name} ${admin.last_name}`.trim() || null,
            recipient_source: MarketingRecipientSource.SCHOOL_ADMIN,
          });
        }
      }
    }

    if (wantsSchoolEmail) {
      for (const school of eligible) {
        const normalized = normalizeMarketingEmail(school.email);
        if (!isValidMarketingEmail(normalized)) {
          invalidEmailCount += 1;
          continue;
        }
        candidates.push({
          school_id: school.id,
          school_name: school.name || null,
          normalized_email: normalized as string,
          recipient_name: school.name || null,
          recipient_source: MarketingRecipientSource.SCHOOL_EMAIL,
        });
      }
    }

    // The final list: school-major order (school email first, then admins),
    // which is the order the snapshot rows are written in.
    const bySchool = new Map<string, MarketingAudienceRecipient[]>();
    for (const candidate of candidates) {
      const key = candidate.school_id ?? '';
      const list = bySchool.get(key) ?? [];
      list.push(candidate);
      bySchool.set(key, list);
    }
    const orderedCandidates: MarketingAudienceRecipient[] = [];
    for (const school of eligible) {
      const list = bySchool.get(school.id) ?? [];
      orderedCandidates.push(
        ...list.sort((a, b) => {
          if (a.recipient_source !== b.recipient_source) {
            return a.recipient_source === MarketingRecipientSource.SCHOOL_EMAIL ? -1 : 1;
          }
          return a.normalized_email.localeCompare(b.normalized_email);
        }),
      );
    }
    // Admins without a school row cannot happen (they are fetched per school),
    // but keep the builder total anyway.
    for (const candidate of candidates) {
      if (candidate.school_id === null) {
        orderedCandidates.push(candidate);
      }
    }

    // ---- Step 5: deduplicate by normalized address. ----
    const unique = new Map<string, MarketingAudienceRecipient>();
    let duplicateCount = 0;
    for (const candidate of orderedCandidates) {
      if (unique.has(candidate.normalized_email)) {
        duplicateCount += 1;
        continue;
      }
      unique.set(candidate.normalized_email, candidate);
    }

    // ---- Step 6: exclude suppressed addresses. ----
    const uniqueEmails = [...unique.keys()];
    let suppressedCount = 0;
    if (uniqueEmails.length > 0) {
      const suppressedRows = (await this.suppressions.findAll({
        where: { normalized_email: { [Op.in]: uniqueEmails } },
        attributes: ['normalized_email'],
      })) as unknown as Array<{ normalized_email: string }>;
      const suppressed = new Set(suppressedRows.map((row) => row.normalized_email));
      for (const email of suppressed) {
        if (unique.delete(email)) {
          suppressedCount += 1;
        }
      }
    }

    const recipients = [...unique.values()];

    return {
      filter: normalizedFilter,
      total_eligible_schools: eligible.length,
      invalid_email_count: invalidEmailCount,
      suppressed_recipient_count: suppressedCount,
      duplicate_recipient_count: duplicateCount,
      final_recipient_count: recipients.length,
      recipients,
      snapshot_hash: computeMarketingAudienceSnapshotHash(recipients),
    };
  }

  /**
   * Builds the audience preview response: counts, a bounded masked sample and
   * the snapshot hash — never the resolved address list.
   */
  async preview(
    filter: MarketingCampaignAudienceFilter,
  ): Promise<MarketingAudiencePreviewResponse> {
    const computation = await this.computeAudience(filter);
    const sample: MarketingAudienceMaskedRecipient[] = computation.recipients
      .slice(0, MARKETING_AUDIENCE_SAMPLE_SIZE)
      .map((recipient) => ({
        school_id: recipient.school_id,
        masked_email: maskMarketingEmail(recipient.normalized_email),
        recipient_source: recipient.recipient_source,
      }));

    return {
      filter: computation.filter,
      total_eligible_schools: computation.total_eligible_schools,
      invalid_email_count: computation.invalid_email_count,
      suppressed_recipient_count: computation.suppressed_recipient_count,
      duplicate_recipient_count: computation.duplicate_recipient_count,
      final_recipient_count: computation.final_recipient_count,
      sample,
      snapshot_hash: computation.snapshot_hash,
    };
  }
}
