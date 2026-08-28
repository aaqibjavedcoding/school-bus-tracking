import { Inject, Injectable } from '@nestjs/common';
import { School } from '../../database/models';
import { SCHOOLS_PLATFORM_REPOSITORY } from './access.constants';

/**
 * Generic business error returned when a school tenant has been deactivated.
 *
 * Deliberately generic: the same message is used at login, refresh and the
 * JWT guard so unauthenticated callers cannot distinguish "no such school"
 * from "school disabled" and authenticated school users get one clear reason.
 */
export const SCHOOL_INACTIVE_MESSAGE = 'School is inactive';

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
  constructor(@Inject(SCHOOLS_PLATFORM_REPOSITORY) private readonly schools: typeof School) {}

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
