import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  AdminSchoolAdminCreateRequest,
  AdminSchoolAdminListResponse,
  AdminSchoolAdminResponse,
  AdminSchoolAdminResetPasswordRequest,
  AdminSchoolAdminUpdateRequest,
  PaginationMeta,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { hashPassword, normalizeEmail } from '../../auth';
import { School, User } from '../../database/models';
import {
  ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE,
  ADMIN_SCHOOLS_REPOSITORY,
  ADMIN_USERS_REPOSITORY,
  SCHOOL_ADMIN_NOT_FOUND_MESSAGE,
  SCHOOL_ADMIN_PASSWORD_RESET_MESSAGE,
  SCHOOL_NOT_FOUND_MESSAGE,
} from './admin.constants';
import { ListSchoolAdminsQueryDto } from './dto/school-admin.dto';

/**
 * Management of a school's SCHOOL_ADMIN accounts by the platform Super Admin.
 *
 * The tenant relationship is always derived from the route's school id
 * server-side: every query is pinned to `(school_id, role=SCHOOL_ADMIN)` and
 * no request body may supply a `school_id` or a `role` (the strict validation
 * pipe rejects them). A SUPER_ADMIN can therefore never accidentally promote
 * an account into another role or another tenant.
 */
@Injectable()
export class AdminSchoolAdminsService {
  constructor(
    @Inject(ADMIN_SCHOOLS_REPOSITORY) private readonly schools: typeof School,
    @Inject(ADMIN_USERS_REPOSITORY) private readonly users: typeof User,
  ) {}

  async list(
    schoolId: string,
    query: ListSchoolAdminsQueryDto,
  ): Promise<AdminSchoolAdminListResponse> {
    await this.requireSchool(schoolId);

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      role: UserRole.SCHOOL_ADMIN,
    };
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { first_name: { [Op.iLike]: pattern } },
        { last_name: { [Op.iLike]: pattern } },
        { email: { [Op.iLike]: pattern } },
      ];
    }

    const { rows, count } = await this.users.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [['created_at', 'ASC']],
    });

    const totalPages = Math.ceil(count / limit);
    const meta: PaginationMeta = {
      page,
      limit,
      total: count,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    };

    return { items: rows.map((admin) => this.toResponse(admin)), meta };
  }

  async create(
    schoolId: string,
    dto: AdminSchoolAdminCreateRequest,
  ): Promise<AdminSchoolAdminResponse> {
    await this.requireSchool(schoolId);

    const email = normalizeEmail(dto.email);
    const existing = await this.users.findOne({
      where: { school_id: schoolId, email },
    });
    if (existing) {
      throw new ConflictException(ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      const admin = await this.users.create({
        school_id: schoolId,
        role: UserRole.SCHOOL_ADMIN,
        first_name: dto.first_name.trim(),
        last_name: dto.last_name.trim(),
        email,
        password_hash: passwordHash,
        email_verified_at: null,
        phone: nullableTrim(dto.phone),
        is_active: dto.is_active ?? true,
      });
      return this.toResponse(admin);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  async update(
    schoolId: string,
    adminId: string,
    dto: AdminSchoolAdminUpdateRequest,
  ): Promise<AdminSchoolAdminResponse> {
    const admin = await this.requireAdmin(schoolId, adminId);
    const updates: Record<string, unknown> = {};

    if (dto.first_name !== undefined) updates.first_name = dto.first_name.trim();
    if (dto.last_name !== undefined) updates.last_name = dto.last_name.trim();
    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      const existing = await this.users.findOne({
        where: { school_id: schoolId, email },
      });
      if (existing && existing.id !== adminId) {
        throw new ConflictException(ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE);
      }
      updates.email = email;
    }
    if (dto.password !== undefined) {
      updates.password_hash = await hashPassword(dto.password);
    }
    if (dto.phone !== undefined) updates.phone = nullableTrim(dto.phone);
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    try {
      await admin.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(ADMIN_ADMIN_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toResponse(admin);
  }

  async setActive(
    schoolId: string,
    adminId: string,
    isActive: boolean,
  ): Promise<AdminSchoolAdminResponse> {
    const admin = await this.requireAdmin(schoolId, adminId);
    if (admin.is_active !== isActive) {
      await admin.update({ is_active: isActive });
    }
    return this.toResponse(admin);
  }

  async resetPassword(
    schoolId: string,
    adminId: string,
    dto: AdminSchoolAdminResetPasswordRequest,
  ): Promise<{ id: string; message: string }> {
    const admin = await this.requireAdmin(schoolId, adminId);
    const passwordHash = await hashPassword(dto.password);
    await admin.update({ password_hash: passwordHash });
    return { id: admin.id, message: SCHOOL_ADMIN_PASSWORD_RESET_MESSAGE };
  }

  private async requireSchool(schoolId: string): Promise<School> {
    const school = await this.schools.findOne({ where: { id: schoolId } });
    if (!school) {
      throw new NotFoundException(SCHOOL_NOT_FOUND_MESSAGE);
    }
    return school;
  }

  /** Loads an admin only when id, tenant and role all match. */
  private async requireAdmin(schoolId: string, adminId: string): Promise<User> {
    await this.requireSchool(schoolId);
    const admin = await this.users.unscoped().findOne({
      where: { id: adminId, school_id: schoolId, role: UserRole.SCHOOL_ADMIN },
    });
    if (!admin) {
      throw new NotFoundException(SCHOOL_ADMIN_NOT_FOUND_MESSAGE);
    }
    return admin;
  }

  /** Explicit projection: password_hash is never exposed. */
  private toResponse(user: User): AdminSchoolAdminResponse {
    return {
      id: user.id,
      school_id: user.school_id as string,
      role: UserRole.SCHOOL_ADMIN,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email as string,
      phone: user.phone,
      is_active: user.is_active,
      email_verified_at: user.email_verified_at ? user.email_verified_at.toISOString() : null,
      created_at: user.created_at.toISOString(),
      updated_at: user.updated_at.toISOString(),
    };
  }
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
