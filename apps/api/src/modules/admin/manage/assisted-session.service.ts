import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { Sequelize } from 'sequelize-typescript';
import {
  AssistedManagementSession,
  ASSISTED_SESSION_END_REASONS,
  type AssistedManagementSessionCreationAttributes,
} from '../../../database/models';
import {
  AUDIT_ACTIONS,
  AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
  AUDIT_ENTITY_TYPES,
  AuditService,
} from '../../audit';
import {
  ADMIN_MANAGE_SESSIONS_REPOSITORY,
  ADMIN_MANAGE_SEQUELIZE,
  type ManagedSchoolContext,
} from './admin-manage.constants';

/** `WHERE` clause matching the actor's still-open session in the school. */
function openSessionWhere(schoolId: string, actorUserId: string): Record<string, unknown> {
  return { school_id: schoolId, actor_user_id: actorUserId, ended_at: null };
}

/** Who is entering/leaving a school (always the verified Super Admin). */
export interface AssistedSessionActor {
  userId: string;
}

/** Client request metadata captured with the session for audit purposes. */
export interface AssistedSessionRequestInfo {
  ip_address?: string | null;
}

/**
 * Lifecycle of an assisted-management session.
 *
 * A session is opened when the Super Admin presses **Manage Data** on a school
 * and closed when they press **Exit** (or implicitly, when a newer session for
 * the same actor + school replaces it, e.g. after an abandoned tab). Each row
 * records the actor, the managed school, the start/end timestamps and the
 * close reason; every audit row produced while the session is open references
 * its id, so the existing audit trail reads:
 *
 * **Actor:** Platform/Super Admin · **School:** ABC · **Context:** Assisted Management
 *
 * Sessions are plain rows — no impersonation is involved anywhere: the actor's
 * token, role and tenant stay the platform Super Admin's own.
 */
@Injectable()
export class AssistedSessionService {
  private readonly logger = new Logger(AssistedSessionService.name);

  constructor(
    @Inject(ADMIN_MANAGE_SESSIONS_REPOSITORY)
    private readonly sessions: typeof AssistedManagementSession,
    private readonly audit: AuditService,
    /**
     * Optional so unit tests can construct the service with repository stubs
     * only; the running app always wires the real instance for transactions.
     */
    @Optional()
    @Inject(ADMIN_MANAGE_SEQUELIZE)
    private readonly sequelize?: Sequelize | null,
  ) {}

  /**
   * Opens a session for the actor in the managed school.
   *
   * An open session for the same actor + school is closed as `superseded`
   * first, so a fresh "Manage Data" entry always starts a clean, well-bounded
   * session instead of accumulating stale open rows.
   */
  async start(
    school: ManagedSchoolContext,
    actor: AssistedSessionActor,
    requestInfo: AssistedSessionRequestInfo = {},
  ) {
    await this.closeOpenSessions(school.id, actor.userId, ASSISTED_SESSION_END_REASONS.SUPERSEDED);

    const attributes: AssistedManagementSessionCreationAttributes = {
      school_id: school.id,
      actor_user_id: actor.userId,
      started_at: new Date(),
      ended_at: null,
      end_reason: null,
      ip_address: requestInfo.ip_address ?? null,
    };

    const created = this.sequelize
      ? await this.sequelize.transaction((transaction) =>
          this.sessions.create(attributes, { transaction }),
        )
      : await this.sessions.create(attributes);

    await this.audit.log({
      school_id: school.id,
      actor_user_id: actor.userId,
      action: AUDIT_ACTIONS.ASSISTED_SESSION_START,
      entity_type: AUDIT_ENTITY_TYPES.ASSISTED_MANAGEMENT_SESSION,
      entity_id: created.id,
      ip_address: requestInfo.ip_address ?? null,
      metadata: {
        context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
        managed_school_name: school.name,
        managed_school_code: school.code,
      },
    });

    return created;
  }

  /**
   * Closes the actor's open session in the school as `exit`.
   *
   * Idempotent: with no open session it resolves `null` so a duplicated
   * "Exit" (double click, retried request) cannot fabricate a second close.
   */
  async end(school: ManagedSchoolContext, actor: AssistedSessionActor) {
    const closed = await this.closeOpenSessions(
      school.id,
      actor.userId,
      ASSISTED_SESSION_END_REASONS.EXIT,
    );

    if (closed) {
      await this.audit.log({
        school_id: school.id,
        actor_user_id: actor.userId,
        action: AUDIT_ACTIONS.ASSISTED_SESSION_END,
        entity_type: AUDIT_ENTITY_TYPES.ASSISTED_MANAGEMENT_SESSION,
        entity_id: closed.id,
        metadata: {
          context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
          managed_school_name: school.name,
          managed_school_code: school.code,
          duration_ms: closed.ended_at
            ? closed.ended_at.getTime() - closed.started_at.getTime()
            : null,
        },
      });
    }

    return closed;
  }

  /**
   * The actor's open session in the school, or `null`. The banner restore path
   * calls this on every page load of the managed area, so it stays a single
   * indexed lookup.
   */
  async findOpen(schoolId: string, actorUserId: string) {
    return this.sessions.findOne({
      where: openSessionWhere(schoolId, actorUserId),
    });
  }

  /**
   * Id of the actor's open session in the school — stamped into the audit
   * metadata of every assisted mutation, import, export and report export.
   */
  async findOpenSessionId(schoolId: string, actorUserId: string): Promise<string | null> {
    const open = await this.findOpen(schoolId, actorUserId);
    return open?.id ?? null;
  }

  /** Closes every open session of the actor in the school; returns the last one. */
  private async closeOpenSessions(
    schoolId: string,
    actorUserId: string,
    reason: (typeof ASSISTED_SESSION_END_REASONS)[keyof typeof ASSISTED_SESSION_END_REASONS],
  ): Promise<AssistedManagementSession | null> {
    const open = await this.sessions.findAll({
      where: openSessionWhere(schoolId, actorUserId),
      order: [['started_at', 'DESC']],
    });

    if (open.length === 0) {
      return null;
    }

    const endedAt = new Date();
    await this.sessions.update(
      { ended_at: endedAt, end_reason: reason },
      {
        where: { id: open.map((session) => session.id) },
      },
    );

    // Keep the in-memory instances consistent with the rows just written —
    // plain assignment works for Sequelize model instances and test stubs alike.
    for (const session of open) {
      const mutable = session as unknown as { ended_at: Date | null; end_reason: typeof reason };
      mutable.ended_at = endedAt;
      mutable.end_reason = reason;
    }

    if (open.length > 1) {
      this.logger.warn(
        `Closed ${open.length} overlapping assisted sessions for actor ${actorUserId} in school ${schoolId}`,
      );
    }

    return open[0];
  }
}
