import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Op, UniqueConstraintError, type WhereOptions } from 'sequelize';
import {
  BusDeleteResponse,
  BusListResponse,
  BusResponse,
  PaginationMeta,
} from '@school-bus-tracking/shared-types';
import { Bus, BusAttributes } from '../../database/models';
import {
  BUS_DELETED_MESSAGE,
  BUS_NOT_FOUND_MESSAGE,
  BUS_NUMBER_TAKEN_MESSAGE,
  BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE,
  BUSES_REPOSITORY,
} from './buses.constants';
import { CreateBusDto } from './dto/create-bus.dto';
import { ListBusesQueryDto } from './dto/list-buses-query.dto';
import { UpdateBusDto } from './dto/update-bus.dto';

/**
 * Tenant-safe fleet (bus) management.
 *
 * Every operation receives `schoolId` from the authenticated user's verified
 * JWT claims (never from the request body/params) and pins every query with
 * `where: { school_id: schoolId }`. Cross-tenant probes therefore see exactly
 * the same generic `404 Bus not found` as a missing record — the existence of
 * another school's bus is never revealed.
 */
@Injectable()
export class BusesService {
  constructor(@Inject(BUSES_REPOSITORY) private readonly buses: typeof Bus) {}

  /**
   * Creates a bus inside the authenticated school.
   *
   * `school_id` is forced to `schoolId` regardless of any (rejected) client
   * input. Registration number and fleet bus number are unique per tenant
   * (soft-deleted rows release their identifiers).
   */
  async create(schoolId: string, dto: CreateBusDto): Promise<BusResponse> {
    const registrationNumber = dto.registration_number.trim();
    const busNumber = nullableTrim(dto.bus_number);

    await this.assertRegistrationNumberFree(schoolId, registrationNumber);
    if (busNumber) {
      await this.assertBusNumberFree(schoolId, busNumber);
    }

    try {
      const bus = await this.buses.create({
        school_id: schoolId,
        registration_number: registrationNumber,
        bus_number: busNumber,
        capacity: dto.capacity,
        is_active: dto.is_active ?? true,
      });
      return this.toBusResponse(bus);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(this.uniqueConflictMessage(error));
      }
      throw error;
    }
  }

  /**
   * Lists buses of the authenticated school only, with pagination and an
   * optional case-insensitive search over registration / fleet number. No
   * other tenant's rows can match because `school_id` is always part of the
   * where clause.
   */
  async findAll(schoolId: string, query: ListBusesQueryDto): Promise<BusListResponse> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where: Record<PropertyKey, unknown> = { school_id: schoolId };
    const search = query.search?.trim();
    if (search) {
      const pattern = `%${escapeLikePattern(search)}%`;
      where[Op.or] = [
        { registration_number: { [Op.iLike]: pattern } },
        { bus_number: { [Op.iLike]: pattern } },
      ];
    }

    const { rows, count } = await this.buses.findAndCountAll({
      where: where as WhereOptions,
      limit,
      offset: (page - 1) * limit,
      order: [
        ['registration_number', 'ASC'],
        ['bus_number', 'ASC'],
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
      items: rows.map((bus) => this.toBusResponse(bus)),
      meta,
    };
  }

  /** Returns one bus only when both the id and the authenticated school_id match. */
  async findOne(schoolId: string, id: string): Promise<BusResponse> {
    const bus = await this.findBusOrThrow(schoolId, id);
    return this.toBusResponse(bus);
  }

  /**
   * Partial update of a bus that belongs to the authenticated school.
   *
   * Ownership is immutable through the API: `school_id` is neither accepted
   * in the DTO nor ever written by this method. Explicit `null` clears the
   * nullable `bus_number`.
   */
  async update(schoolId: string, id: string, dto: UpdateBusDto): Promise<BusResponse> {
    const bus = await this.findBusOrThrow(schoolId, id);

    const updates: Partial<BusAttributes> = {};
    if (dto.registration_number !== undefined) {
      updates.registration_number = dto.registration_number.trim();
      await this.assertRegistrationNumberFree(schoolId, updates.registration_number, id);
    }
    if (dto.bus_number !== undefined) {
      updates.bus_number = nullableTrim(dto.bus_number);
      if (updates.bus_number) {
        await this.assertBusNumberFree(schoolId, updates.bus_number, id);
      }
    }
    if (dto.capacity !== undefined) {
      updates.capacity = dto.capacity;
    }
    if (dto.is_active !== undefined) {
      updates.is_active = dto.is_active;
    }

    try {
      await bus.update(updates);
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        throw new ConflictException(this.uniqueConflictMessage(error));
      }
      throw error;
    }

    return this.toBusResponse(bus);
  }

  /**
   * Soft deletes (paranoid model → sets `deleted_at`) a bus of the
   * authenticated school. Records are never physically removed.
   */
  async remove(schoolId: string, id: string): Promise<BusDeleteResponse> {
    const bus = await this.findBusOrThrow(schoolId, id);
    await bus.destroy();
    return { id, message: BUS_DELETED_MESSAGE };
  }

  private async findBusOrThrow(schoolId: string, id: string): Promise<Bus> {
    const bus = await this.buses.findOne({
      where: { id, school_id: schoolId },
    });
    if (!bus) {
      throw new NotFoundException(BUS_NOT_FOUND_MESSAGE);
    }
    return bus;
  }

  /** Rejects a registration number already used by another active bus of the
   * same school; `excludeId` lets updates skip the row being edited. */
  private async assertRegistrationNumberFree(
    schoolId: string,
    registrationNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      registration_number: registrationNumber,
    };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.buses.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE);
    }
  }

  /** Rejects a fleet bus number already used by another active bus of the
   * same school; `excludeId` lets updates skip the row being edited. */
  private async assertBusNumberFree(
    schoolId: string,
    busNumber: string,
    excludeId?: string,
  ): Promise<void> {
    const where: Record<PropertyKey, unknown> = {
      school_id: schoolId,
      bus_number: busNumber,
    };
    if (excludeId) {
      where.id = { [Op.ne]: excludeId };
    }
    const existing = await this.buses.findOne({ where: where as WhereOptions });
    if (existing) {
      throw new ConflictException(BUS_NUMBER_TAKEN_MESSAGE);
    }
  }

  /**
   * Maps a racing unique-constraint violation to the field that collided so
   * the client gets a precise message even when the pre-check lost a race.
   */
  private uniqueConflictMessage(error: UniqueConstraintError): string {
    const path = error.errors?.[0]?.path ?? Object.keys(error.fields ?? {})[0];
    return path === 'bus_number' ? BUS_NUMBER_TAKEN_MESSAGE : BUS_REGISTRATION_NUMBER_TAKEN_MESSAGE;
  }

  /** Explicit field-by-field projection — no internal or sensitive field leaks. */
  private toBusResponse(bus: Bus): BusResponse {
    return {
      id: bus.id,
      school_id: bus.school_id,
      registration_number: bus.registration_number,
      bus_number: bus.bus_number,
      capacity: bus.capacity,
      is_active: bus.is_active,
      created_at: bus.created_at.toISOString(),
      updated_at: bus.updated_at.toISOString(),
    };
  }
}

function nullableTrim(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Escapes LIKE wildcards so user input is matched literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
