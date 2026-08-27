import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { UniqueConstraintError } from 'sequelize';
import { SchoolOnboardingResponse, UserRole } from '@school-bus-tracking/shared-types';
import { hashPassword, normalizeEmail } from '../../auth';
import { School, User } from '../../database/models';
import {
  ADMIN_EMAIL_TAKEN_MESSAGE,
  ONBOARDING_CONFLICT_MESSAGE,
  SCHOOL_CODE_TAKEN_MESSAGE,
  SCHOOLS_REPOSITORY,
  SCHOOLS_USERS_REPOSITORY,
} from './schools.constants';
import { OnboardSchoolDto } from './dto/onboard-school.dto';

/**
 * School onboarding: provisions a new tenant (school) and its first school
 * admin account in one atomic Sequelize transaction.
 *
 * Only a platform operator with `SUPER_ADMIN` can reach this service — the
 * role check lives on the controller (JwtAuthGuard + RolesGuard), so a school
 * admin can never create arbitrary tenants.
 */
@Injectable()
export class SchoolsService {
  constructor(
    @Inject(SCHOOLS_REPOSITORY) private readonly schools: typeof School,
    @Inject(SCHOOLS_USERS_REPOSITORY) private readonly users: typeof User,
  ) {}

  /**
   * Creates the school and admin atomically.
   *
   * - Admin email is normalized (trim + lowercase) before storage; the model
   *   setter enforces the same rule as a second layer.
   * - The password is bcrypt-hashed with the existing `hashPassword` utility
   *   and only ever persisted as `password_hash`.
   * - Both `schools.code` (platform-wide) and the admin email (tenant-scoped)
   *   are checked inside the transaction; unique-index constraints are the
   *   final race-safe guarantee and are translated to 409 conflicts.
   * - The response is an explicit projection — no password, password_hash or
   *   internal field can ever reach the client.
   */
  async onboard(dto: OnboardSchoolDto): Promise<SchoolOnboardingResponse> {
    const schoolName = dto.school.name.trim();
    const schoolCode = dto.school.code;
    const email = normalizeEmail(dto.admin.email);
    const { first_name: firstName, last_name: lastName } = splitAdminName(dto.admin.name);
    const passwordHash = await hashPassword(dto.admin.password);
    const sequelize = this.schools.sequelize;
    if (!sequelize) {
      throw new Error('Schools model is not bound to a Sequelize instance');
    }

    try {
      return await sequelize.transaction(async (transaction) => {
        const existingSchool = await this.schools.findOne({
          where: { code: schoolCode },
          transaction,
        });
        if (existingSchool) {
          throw new ConflictException(SCHOOL_CODE_TAKEN_MESSAGE);
        }

        const school = await this.schools.create(
          {
            name: schoolName,
            code: schoolCode,
            is_active: true,
          },
          { transaction },
        );

        // Tenant-scoped duplicate check: the admin email must be unique inside
        // the new school. Emails may repeat across schools.
        const existingAdmin = await this.users.unscoped().findOne({
          where: { school_id: school.id, email },
          transaction,
        });
        if (existingAdmin) {
          throw new ConflictException(ADMIN_EMAIL_TAKEN_MESSAGE);
        }

        const admin = await this.users.create(
          {
            school_id: school.id,
            role: UserRole.SCHOOL_ADMIN,
            first_name: firstName,
            last_name: lastName,
            email,
            password_hash: passwordHash,
            email_verified_at: null,
            is_active: true,
          },
          { transaction },
        );

        return {
          school: this.toSchoolResponse(school),
          admin: this.toAdminResponse(admin),
        };
      });
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(this.describeUniqueConflict(error));
      }
      throw error;
    }
  }

  /** Maps a unique-constraint violation to the most specific 409 message. */
  private describeUniqueConflict(error: UniqueConstraintError): string {
    const fields = Object.keys(error.fields ?? {});
    if (fields.includes('code')) {
      return SCHOOL_CODE_TAKEN_MESSAGE;
    }
    if (fields.includes('email')) {
      return ADMIN_EMAIL_TAKEN_MESSAGE;
    }
    return ONBOARDING_CONFLICT_MESSAGE;
  }

  private toSchoolResponse(school: School): SchoolOnboardingResponse['school'] {
    return {
      id: school.id,
      name: school.name,
      code: school.code,
      is_active: school.is_active,
      created_at: school.created_at.toISOString(),
      updated_at: school.updated_at.toISOString(),
    };
  }

  private toAdminResponse(user: User): SchoolOnboardingResponse['admin'] {
    return {
      id: user.id,
      school_id: user.school_id,
      role: UserRole.SCHOOL_ADMIN,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email as string,
    };
  }
}

/**
 * Splits a full display name into `first_name` and `last_name`.
 *
 * The DTO already guarantees at least two whitespace-separated tokens; the
 * first token becomes `first_name` and everything after it stays in
 * `last_name` (so multi-word surnames are preserved).
 */
function splitAdminName(name: string): { first_name: string; last_name: string } {
  const parts = name.trim().split(/\s+/);
  const [first] = parts;
  const last = parts.slice(1).join(' ');
  return { first_name: first, last_name: last };
}
