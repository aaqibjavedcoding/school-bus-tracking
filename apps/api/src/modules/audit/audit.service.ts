import { Inject, Injectable, Logger } from '@nestjs/common';
import { Op, type WhereOptions } from 'sequelize';
import { AuditLog, User } from '../../database/models';
import {
  AUDIT_METADATA_MAX_BYTES,
  AUDIT_REDACTED_FIELDS,
  AUDIT_REPOSITORY,
  AUDIT_USER_REPOSITORY,
  type AuditAction,
  type AuditEntityType,
} from './audit.constants';

/** Input for recording an audit event. */
export interface AuditLogInput {
  school_id?: string | null;
  actor_user_id?: string | null;
  action: AuditAction;
  entity_type: AuditEntityType;
  entity_id?: string | null;
  request_id?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address?: string | null;
}

/** Paginated query for the audit-log UI. */
export interface ListAuditLogsQuery {
  page?: number;
  limit?: number;
  school_id?: string;
  actor_user_id?: string;
  action?: string;
  entity_type?: string;
  entity_id?: string;
  date_from?: string;
  date_to?: string;
}

export interface AuditLogResponse {
  id: string;
  school_id: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
}

export interface AuditLogListResponse {
  items: AuditLogResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * Durable audit logging service.
 *
 * Every method is fire-and-forget from the caller's perspective: audit
 * failures are logged but never propagated, so a broken audit trail cannot
 * break the operation being audited.
 *
 * Sensitive fields are stripped from metadata before persistence.
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @Inject(AUDIT_REPOSITORY)
    private readonly auditLogs: typeof AuditLog,
    @Inject(AUDIT_USER_REPOSITORY)
    private readonly users: typeof User,
  ) {}

  /**
   * Records one audit event. Best-effort: errors are logged, never thrown.
   */
  async log(input: AuditLogInput): Promise<void> {
    try {
      const sanitized = this.sanitizeMetadata(input.metadata);
      await this.auditLogs.create({
        school_id: input.school_id ?? null,
        actor_user_id: input.actor_user_id ?? null,
        action: input.action,
        entity_type: input.entity_type,
        entity_id: input.entity_id ?? null,
        request_id: input.request_id ?? null,
        metadata: sanitized,
        ip_address: input.ip_address ?? null,
      } as never);
    } catch (error) {
      // Audit failures must never break the audited operation.
      this.logger.error(
        `Audit log write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Lists audit logs with pagination and filtering.
   * Tenant-scoped: when `schoolId` is provided, only that school's logs
   * are returned. Super Admin may omit `schoolId` to see platform-wide logs.
   */
  async list(
    query: ListAuditLogsQuery,
    options: { schoolId?: string } = {},
  ): Promise<AuditLogListResponse> {
    const page = Math.max(1, Math.floor(query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 20)));

    const where: WhereOptions = {};

    // Tenant isolation: if a school context is provided, pin to it.
    if (options.schoolId) {
      (where as Record<string, unknown>).school_id = options.schoolId;
    } else if (query.school_id) {
      (where as Record<string, unknown>).school_id = query.school_id;
    }

    if (query.actor_user_id) {
      (where as Record<string, unknown>).actor_user_id = query.actor_user_id;
    }
    if (query.action) {
      (where as Record<string, unknown>).action = query.action;
    }
    if (query.entity_type) {
      (where as Record<string, unknown>).entity_type = query.entity_type;
    }
    if (query.entity_id) {
      (where as Record<string, unknown>).entity_id = query.entity_id;
    }

    if (query.date_from || query.date_to) {
      const range: Record<symbol, Date> = {};
      if (query.date_from) {
        range[Op.gte] = new Date(`${query.date_from}T00:00:00.000Z`);
      }
      if (query.date_to) {
        range[Op.lt] = new Date(
          new Date(`${query.date_to}T00:00:00.000Z`).getTime() + 86_400_000,
        );
      }
      (where as Record<string, unknown>).created_at = range;
    }

    const { rows, count } = await this.auditLogs.findAndCountAll({
      where,
      limit,
      offset: (page - 1) * limit,
      order: [['created_at', 'DESC']],
    });

    // Resolve actor names in batch.
    const actorIds = [...new Set(rows.map((r) => r.actor_user_id).filter(Boolean))] as string[];
    const actorMap = new Map<string, string>();
    if (actorIds.length > 0) {
      const actors = await this.users.findAll({
        where: { id: actorIds } as WhereOptions,
        attributes: ['id', 'first_name', 'last_name'],
      });
      for (const actor of actors) {
        actorMap.set(actor.id, `${actor.first_name} ${actor.last_name}`.trim());
      }
    }

    const totalPages = Math.ceil(count / limit);

    return {
      items: rows.map((row) => ({
        id: row.id,
        school_id: row.school_id,
        actor_user_id: row.actor_user_id,
        actor_name: row.actor_user_id ? (actorMap.get(row.actor_user_id) ?? null) : null,
        action: row.action,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        request_id: row.request_id,
        metadata: row.metadata,
        ip_address: row.ip_address,
        created_at: row.created_at instanceof Date
          ? row.created_at.toISOString()
          : new Date(row.created_at).toISOString(),
      })),
      total: count,
      page,
      limit,
      totalPages,
    };
  }

  /**
   * Strips sensitive fields from metadata and enforces size limits.
   */
  private sanitizeMetadata(
    metadata: Record<string, unknown> | null | undefined,
  ): Record<string, unknown> | null {
    if (!metadata) {
      return null;
    }

    const sanitized = this.redactSensitive(metadata);
    const json = JSON.stringify(sanitized);
    if (json.length > AUDIT_METADATA_MAX_BYTES) {
      // Truncate oversized metadata rather than dropping it entirely.
      return { _truncated: true, _partial: json.slice(0, AUDIT_METADATA_MAX_BYTES - 50) };
    }
    return sanitized;
  }

  /**
   * Recursively removes sensitive fields from an object.
   */
  private redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (AUDIT_REDACTED_FIELDS.some((field) => lower.includes(field))) {
        result[key] = '[REDACTED]';
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.redactSensitive(value as Record<string, unknown>);
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
