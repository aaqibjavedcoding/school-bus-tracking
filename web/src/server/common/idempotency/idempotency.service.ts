import { Logger } from '../../framework';
import { ConfigService } from '../../framework';
import { UniqueConstraintError } from 'sequelize';
import { IdempotencyKey } from '../../database/models';

/**
 * Default TTL for idempotency keys (24 hours).
 */
const DEFAULT_TTL_HOURS = 24;

/**
 * Result of an idempotency check.
 */
export type IdempotencyResult =
  | { status: 'new' }
  | { status: 'duplicate'; responseStatus: number; responseBody: Record<string, unknown> };

/**
 * Idempotency service for critical mutations.
 *
 * Uses client-generated idempotency keys to prevent duplicate processing
 * of critical operations (boarding, drop, SOS, trip status transitions).
 *
 * The key is scoped to (school_id, user_id, endpoint) so:
 * - Different users can use the same key independently
 * - Different endpoints (and therefore different resource types) are isolated
 * - Tenant isolation is maintained
 *
 * `schoolId === null` is the explicit **platform** scope used by SUPER_ADMIN
 * records, which belong to no tenant. It is not an absence of scoping: the
 * caller passes an `endpoint` built by `buildIdempotencyScope()`, which
 * carries both the resource type and a `platform:` / `school:` marker, and
 * the database enforces uniqueness with two partial indexes (one per scope)
 * because `NULL != NULL` in PostgreSQL.
 *
 * Concurrency safety: the unique constraint on the lookup index ensures
 * that concurrent requests with the same key are serialized by PostgreSQL.
 */
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly ttlHours: number;

  constructor(
    private readonly idempotencyKeys: typeof IdempotencyKey,
    private readonly configService: ConfigService,
  ) {
    this.ttlHours = this.configService.get<number>('idempotency.ttlHours', DEFAULT_TTL_HOURS);
  }

  /**
   * Checks if an idempotency key already exists and returns the stored result
   * if it does. Returns `{ status: 'new' }` if the key is fresh.
   */
  async check(params: {
    /** `null` = platform scope (SUPER_ADMIN records with no tenant). */
    schoolId: string | null;
    userId: string;
    endpoint: string;
    idempotencyKey: string;
  }): Promise<IdempotencyResult> {
    const existing = await this.idempotencyKeys.findOne({
      where: {
        // Sequelize renders `null` as `IS NULL`, which is exactly the
        // platform-scope predicate the partial unique index uses.
        school_id: params.schoolId,
        user_id: params.userId,
        endpoint: params.endpoint,
        idempotency_key: params.idempotencyKey,
      },
    });

    if (!existing) {
      return { status: 'new' };
    }

    // Check if the key has expired.
    if (existing.expires_at < new Date()) {
      await existing.destroy();
      return { status: 'new' };
    }

    return {
      status: 'duplicate',
      responseStatus: existing.response_status,
      responseBody: existing.response_body,
    };
  }

  /**
   * Stores the result of an idempotent operation.
   * If the insert fails due to a race (unique constraint), the caller
   * should re-check and return the existing result.
   */
  async store(params: {
    /** `null` = platform scope (SUPER_ADMIN records with no tenant). */
    schoolId: string | null;
    userId: string;
    endpoint: string;
    idempotencyKey: string;
    responseStatus: number;
    responseBody: Record<string, unknown>;
  }): Promise<void> {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + this.ttlHours);

    try {
      await this.idempotencyKeys.create({
        school_id: params.schoolId,
        user_id: params.userId,
        endpoint: params.endpoint,
        idempotency_key: params.idempotencyKey,
        response_status: params.responseStatus,
        response_body: params.responseBody,
        expires_at: expiresAt,
      } as never);
    } catch (error) {
      // A unique violation means a concurrent request with the same key
      // stored first — expected and safe, the stored row wins.
      if (error instanceof UniqueConstraintError) {
        this.logger.debug(
          `Idempotency key store race (key=${params.idempotencyKey}): concurrent request stored first`,
        );
        return;
      }
      // Any other failure (connection loss, serialization) must be visible
      // to the caller: it decides whether the operation can proceed without
      // a stored receipt. The route runtime treats it as best-effort.
      this.logger.warn(
        `Idempotency key store failed (key=${params.idempotencyKey}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw error;
    }
  }

  /**
   * Cleans up expired idempotency keys. Called by the worker infrastructure.
   * Returns the number of deleted keys.
   */
  async cleanup(): Promise<number> {
    const { Op } = await import('sequelize');
    const deleted = await this.idempotencyKeys.destroy({
      where: {
        expires_at: { [Op.lt]: new Date() },
      } as never,
    });
    return deleted;
  }
}
