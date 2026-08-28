import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  StaffResponse,
  StaffRole,
  StaffListResponse,
  StaffDeleteResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { hashPassword, normalizeEmail } from '../../auth';
import { User } from '../../database/models';
import {
  STAFF_EMAIL_TAKEN_MESSAGE,
  STAFF_REPOSITORY,
  staffDeletedMessage,
  staffNotFoundMessage,
} from './staff.constants';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ListStaffQueryDto } from './dto/list-staff-query.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';

/** Paginated staff payload; `items` carries the caller's concrete staff role. */
export type StaffListResponseOf<R extends StaffRole> = StaffListResponse<StaffResponse<R>>;

/**
 * Tenant-safe management of users whose fixed role is `DRIVER` or
 * `CONDUCTOR`.
 *
 * One service instance conceptually manages one staff role: the controller
 * for `/drivers` always passes `UserRole.DRIVER` and the controller for
 * `/conductors` always passes `UserRole.CONDUCTOR`. The role is therefore a
 * server-owned constant per route — it is never read from a client body — and
 * every read and write is pinned to the `school_id` extracted from the
 * verified JWT claims. There is no client-controlled tenant or role field in
 * any staff DTO.
 */
@Injectable()
export class StaffService {
  constructor(@Inject(STAFF_REPOSITORY) private readonly users: typeof User) {}

  /**
   * Creates a driver or conductor account that can use the existing
   * `/auth/login` flow. The role and school are server-owned, and the
   * password is persisted only as a bcrypt digest.
   */
  async create<R extends StaffRole>(
    schoolId: string,
    role: R,
    dto: CreateStaffDto,
  ): Promise<StaffResponse<R>> {
    const email = normalizeEmail(dto.email);
    // Email uniqueness is tenant-scoped across ALL user roles (the unique
    // index is (school_id, email)), so a staff email may not collide with a
    // school admin or parent either.
    const existing = await this.users.findOne({ where: { school_id: schoolId, email } });
    if (existing) {
      throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      const member = await this.users.create({
        school_id: schoolId,
        role,
        first_name: dto.first_name.trim(),
        last_name: dto.last_name.trim(),
        email,
        password_hash: passwordHash,
        email_verified_at: null,
        phone: nullableTrim(dto.phone),
        is_active: dto.is_active ?? true,
      });
      return this.toStaffResponse(member, role);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /** Lists only staff users of the given role belonging to the JWT tenant. */
  async findAll<R extends StaffRole>(
    schoolId: string,
    role: R,
    query: ListStaffQueryDto,
  ): Promise<StaffListResponseOf<R>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      role,
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
      order: [
        ['last_name', 'ASC'],
        ['first_name', 'ASC'],
      ],
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

    return {
      items: rows.map((member) => this.toStaffResponse(member, role)),
      meta,
    };
  }

  /** Returns a staff account only when its id, tenant and role all match. */
  async findOne<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
  ): Promise<StaffResponse<R>> {
    return this.toStaffResponse(await this.findStaffOrThrow(schoolId, role, id), role);
  }

  /**
   * Updates a staff account without ever changing its tenant or role.
   * Supplying a new password hashes it with the same bcrypt utility used by
   * school onboarding and parent management.
   */
  async update<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
    dto: UpdateStaffDto,
  ): Promise<StaffResponse<R>> {
    const member = await this.findStaffOrThrow(schoolId, role, id);
    const updates: Record<string, unknown> = {};

    if (dto.first_name !== undefined) updates.first_name = dto.first_name.trim();
    if (dto.last_name !== undefined) updates.last_name = dto.last_name.trim();
    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      // Again scoped across all roles: the (school_id, email) index is shared.
      const existing = await this.users.findOne({ where: { school_id: schoolId, email } });
      if (existing && existing.id !== id) {
        throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
      }
      updates.email = email;
    }
    if (dto.password !== undefined) {
      updates.password_hash = await hashPassword(dto.password);
    }
    if (dto.phone !== undefined) updates.phone = nullableTrim(dto.phone);
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    try {
      await member.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(STAFF_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toStaffResponse(member, role);
  }

  /** Soft-deletes the account; historical assignment/trip rows stay auditable. */
  async remove<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
  ): Promise<StaffDeleteResponse> {
    const member = await this.findStaffOrThrow(schoolId, role, id);
    await member.destroy();
    return { id, message: staffDeletedMessage(role) };
  }

  private async findStaffOrThrow<R extends StaffRole>(
    schoolId: string,
    role: R,
    id: string,
  ): Promise<User> {
    const member = await this.users.findOne({
      where: { id, school_id: schoolId, role },
    });
    if (!member) {
      // The same response is used for an unknown id, another tenant and a
      // user of any other role (including the other staff role) so account
      // existence and role membership do not leak.
      throw new NotFoundException(staffNotFoundMessage(role));
    }
    return member;
  }

  /** Explicit projection: password_hash and all ORM-only fields stay private. */
  private toStaffResponse<R extends StaffRole>(member: User, role: R): StaffResponse<R> {
    return {
      id: member.id,
      school_id: member.school_id as string,
      // Echo the server-pinned role rather than trusting the stored row: a
      // response can never advertise a role different from its resource.
      role,
      first_name: member.first_name,
      last_name: member.last_name,
      email: member.email as string,
      phone: member.phone,
      is_active: member.is_active,
      created_at: member.created_at.toISOString(),
      updated_at: member.updated_at.toISOString(),
    };
  }
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Escapes LIKE wildcards so a name/email search is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// Re-exported for controllers/tests that want the role enumeration explicitly.
export { UserRole };
