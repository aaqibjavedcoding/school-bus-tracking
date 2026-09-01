import { Inject, Injectable, Optional } from '@nestjs/common';
import { School, User } from '../../database/models';
import { SCHOOLS_PLATFORM_REPOSITORY, USERS_PLATFORM_REPOSITORY } from './access.constants';

/**
 * Generic business error returned when a school tenant has been deactivated.
 *
 * Deliberately generic: the same message is used at login, refresh and the
 * JWT guard so unauthenticated callers cannot distinguish "no such school"
 * from "school disabled" and authenticated school users get one clear reason.
 */
export const SCHOOL_INACTIVE_MESSAGE = 'School is inactive';

/**
 * Business error returned when the authenticated *account* has been
 * deactivated while it still holds a valid (unexpired) access token.
 *
 * Login already refuses a deactivated user; without this check an access
 * token minted before the deactivation would keep working until it expired.
 */
export const USER_INACTIVE_MESSAGE = 'User account is inactive';

/**
 * Centralized school-lifecycle checks.
 *
 * School activation state lives on `schools.is_active`; this service is the
 * single place the authentication/authorization layers consult, so the
 * inactive-school rule is never duplicated across controllers. A platform
 * `SUPER_ADMIN` (school-scoped claims absent) always passes — platform
 * operators must keep managing inactive tenants.
 */
@Injectable()
export class SchoolAccessService {
  constructor(
    @Inject(SCHOOLS_PLATFORM_REPOSITORY) private readonly schools: typeof School,
    /**
     * Optional so the service stays unit-constructible with a single stub
     * (existing tests) — the global `AccessModule` always provides it.
     */
    @Optional() @Inject(USERS_PLATFORM_REPOSITORY) private readonly users?: typeof User,
  ) {}

  /**
   * True when the account behind a verified token may still act.
   *
   * Returns `true` when no user repository is wired (stubbed unit/smoke
   * bootstraps), so this check can never turn into a hard dependency for
   * tests that do not exercise it.
   */
  async isUserActive(userId: string | null | undefined): Promise<boolean> {
    if (!this.users || !userId) {
      return true;
    }
    const user = await this.users.unscoped().findOne({
      where: { id: userId },
      attributes: ['id', 'is_active'],
      raw: true,
    });
    return Boolean(user && user.is_active);
  }

  /**
   * True when the caller may proceed.
   *
   * - `SUPER_ADMIN` (no school claim): always allowed, even for inactive
   *   tenants — the platform console must manage deactivated schools.
   * - School users: the tenant row must exist, not be soft-deleted and be
   *   active. Lookup failures (e.g. database unavailable in a boot-only
   *   context) propagate so a deactivated tenant can never slip through due
   *   to a swallowed error.
   */
  async isSchoolAccessible(schoolId: string | null | undefined): Promise<boolean> {
    if (schoolId === null || schoolId === undefined) {
      return true;
    }
    const school = await this.schools.findOne({
      where: { id: schoolId },
      attributes: ['id', 'is_active'],
      raw: true,
    });
    return Boolean(school && school.is_active);
  }
}
