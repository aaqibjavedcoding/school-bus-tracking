import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  PaginationMeta,
  PlanLimitResource,
  ParentDeleteResponse,
  ParentListResponse,
  ParentResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { hashPassword, normalizeEmail } from '../../auth';
import { User } from '../../database/models';
import {
  PARENT_DELETED_MESSAGE,
  PARENT_EMAIL_TAKEN_MESSAGE,
  PARENT_NOT_FOUND_MESSAGE,
  PARENTS_REPOSITORY,
} from './parents.constants';
import { CreateParentDto } from './dto/create-parent.dto';
import { ListParentsQueryDto } from './dto/list-parents-query.dto';
import { UpdateParentDto } from './dto/update-parent.dto';
import { PlanLimitsService } from '../../common/plan-limits';

/**
 * Tenant-safe management of users whose fixed role is `PARENT`.
 *
 * This service deliberately receives the school id as a separate argument and
 * applies it to every read and write. Controllers get that value only from
 * `JwtAuthGuard`'s verified claims; there is no client-controlled tenant field
 * in any parent DTO.
 */
@Injectable()
export class ParentsService {
  constructor(
    @Inject(PARENTS_REPOSITORY) private readonly users: typeof User,
    private readonly planLimits: PlanLimitsService,
  ) {}

  /**
   * Creates a parent account that can use the existing `/auth/login` flow.
   * The role and school are server-owned, and the password is persisted only
   * as a bcrypt digest.
   */
  async create(schoolId: string, dto: CreateParentDto): Promise<ParentResponse> {
    await this.planLimits.assertWithinLimit(schoolId, PlanLimitResource.PARENTS);
    const email = normalizeEmail(dto.email);
    const existing = await this.users.findOne({ where: { school_id: schoolId, email } });
    if (existing) {
      throw new ConflictException(PARENT_EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await hashPassword(dto.password);

    try {
      const parent = await this.users.create({
        school_id: schoolId,
        role: UserRole.PARENT,
        first_name: dto.first_name.trim(),
        last_name: dto.last_name.trim(),
        email,
        password_hash: passwordHash,
        email_verified_at: null,
        phone: nullableTrim(dto.phone),
        is_active: dto.is_active ?? true,
      });
      return this.toParentResponse(parent);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(PARENT_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  /** Lists only PARENT users belonging to the authenticated school. */
  async findAll(schoolId: string, query: ListParentsQueryDto): Promise<ParentListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      role: UserRole.PARENT,
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
      items: rows.map((parent) => this.toParentResponse(parent)),
      meta,
    };
  }

  /** Returns a PARENT only when both its id and tenant match. */
  async findOne(schoolId: string, id: string): Promise<ParentResponse> {
    return this.toParentResponse(await this.findParentOrThrow(schoolId, id));
  }

  /**
   * Updates a parent account without ever changing its tenant or role.
   * Supplying a new password hashes it with the same bcrypt utility used by
   * school onboarding and the login credential foundation.
   */
  async update(schoolId: string, id: string, dto: UpdateParentDto): Promise<ParentResponse> {
    const parent = await this.findParentOrThrow(schoolId, id);
    const updates: Record<string, unknown> = {};

    if (dto.first_name !== undefined) updates.first_name = dto.first_name.trim();
    if (dto.last_name !== undefined) updates.last_name = dto.last_name.trim();
    if (dto.email !== undefined) {
      const email = normalizeEmail(dto.email);
      const existing = await this.users.findOne({ where: { school_id: schoolId, email } });
      if (existing && existing.id !== id) {
        throw new ConflictException(PARENT_EMAIL_TAKEN_MESSAGE);
      }
      updates.email = email;
    }
    if (dto.password !== undefined) {
      updates.password_hash = await hashPassword(dto.password);
    }
    if (dto.phone !== undefined) updates.phone = nullableTrim(dto.phone);
    if (dto.is_active !== undefined) updates.is_active = dto.is_active;

    try {
      await parent.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(PARENT_EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }

    return this.toParentResponse(parent);
  }

  /** Soft-deletes the account; historical relationship rows remain auditable. */
  async remove(schoolId: string, id: string): Promise<ParentDeleteResponse> {
    const parent = await this.findParentOrThrow(schoolId, id);
    await parent.destroy();
    return { id, message: PARENT_DELETED_MESSAGE };
  }

  private async findParentOrThrow(schoolId: string, id: string): Promise<User> {
    const parent = await this.users.findOne({
      where: { id, school_id: schoolId, role: UserRole.PARENT },
    });
    if (!parent) {
      // The same response is used for an unknown id, another tenant, and a
      // non-parent user so account existence and role membership do not leak.
      throw new NotFoundException(PARENT_NOT_FOUND_MESSAGE);
    }
    return parent;
  }

  /** Explicit projection: password_hash and all ORM-only fields stay private. */
  private toParentResponse(parent: User): ParentResponse {
    return {
      id: parent.id,
      school_id: parent.school_id as string,
      role: UserRole.PARENT,
      first_name: parent.first_name,
      last_name: parent.last_name,
      email: parent.email as string,
      phone: parent.phone,
      is_active: parent.is_active,
      created_at: parent.created_at.toISOString(),
      updated_at: parent.updated_at.toISOString(),
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
