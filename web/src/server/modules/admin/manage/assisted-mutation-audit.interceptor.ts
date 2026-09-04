import { AUDIT_ACTIONS, AUDIT_CONTEXT_ASSISTED_MANAGEMENT, AuditService } from '../../audit';
import { AssistedSessionService } from './assisted-session.service';
import {
  ASSISTED_AUDIT_ENTITY_BY_RESOURCE,
  type ManagedSchoolContext,
} from './admin-manage.constants';

/** Envelope the global `TransformInterceptor` wraps every JSON response in. */
interface SuccessEnvelope {
  success?: boolean;
  data?: { id?: unknown } | unknown;
}

/** Request augmented by {@link ManagedSchoolGuard}. */
export interface ManagedRequest {
  method: string;
  url: string;
  originalUrl?: string;
  managedSchool?: ManagedSchoolContext;
  user?: { id?: string };
}

/**
 * Audit trail for plain CRUD mutations on assisted-management routes.
 *
 * The tenant feature services (students, buses, routes, …) deliberately do not
 * audit themselves — the tenant controllers never asked them to. Assisted
 * management must, so this interceptor records one row per successful
 * create/update/delete on `/admin/schools/:schoolId/manage/*`:
 *
 * - **Actor** — the authenticated Super Admin (never swapped, never wrapped).
 * - **School** — the managed school from the guarded request context.
 * - **Action** — `assisted.mutation`; the resource and verb travel in metadata.
 * - **Context** — `assisted_management` plus the open session id.
 *
 * Endpoints that persist their own richer, domain-specific audit rows — the
 * import, export and report handlers — are skipped so the trail never records
 * the same event twice. Read-only requests are never audited here.
 */
export class AssistedMutationAuditInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly sessions: AssistedSessionService,
  ) {}

  /**
   * Records the audit row for a successful mutation, if this request is one.
   *
   * Called after the handler resolves, with the success envelope the client
   * will receive — the same value the rxjs `tap` used to observe.
   */
  async record(request: ManagedRequest, payload: SuccessEnvelope): Promise<void> {
    const managedSchool = request.managedSchool;
    const method = request.method.toUpperCase();

    const mutating =
      method === 'POST' || method === 'PATCH' || method === 'PUT' || method === 'DELETE';
    const enabled =
      mutating &&
      Boolean(managedSchool) &&
      !this.pathAuditsItself(request.originalUrl ?? request.url);

    if (!enabled) {
      return;
    }

    await this.write(request, managedSchool as ManagedSchoolContext, payload);
  }

  /**
   * Import / export / report handlers write their own audit rows (with row
   * counts, dataset labels, filters) — a second row from here would duplicate
   * them. Session lifecycle is audited by {@link AssistedSessionService}.
   */
  private pathAuditsItself(path: string): boolean {
    return /\/manage\/(imports|exports|reports|session)(\/|$|\?)/.test(path);
  }
  private async write(
    request: ManagedRequest,
    managedSchool: ManagedSchoolContext,
    payload: SuccessEnvelope,
  ): Promise<void> {
    try {
      const actorId = request.user?.id ?? null;
      if (!actorId) {
        return;
      }

      const resource = this.resourceOf(request.originalUrl ?? request.url);
      const entityType = resource ? ASSISTED_AUDIT_ENTITY_BY_RESOURCE[resource] : undefined;
      if (!entityType) {
        return;
      }

      const entityId = this.extractEntityId(request.originalUrl ?? request.url, payload);

      const sessionId = await this.sessions.findOpenSessionId(managedSchool.id, actorId);

      await this.audit.log({
        school_id: managedSchool.id,
        actor_user_id: actorId,
        action: AUDIT_ACTIONS.ASSISTED_MUTATION,
        entity_type: entityType,
        entity_id: entityId,
        metadata: {
          context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
          assisted_session_id: sessionId,
          resource,
          verb: request.method.toUpperCase(),
          managed_school_name: managedSchool.name,
        },
      });
    } catch {
      // Audit failures must never break the audited operation (mirrors AuditService).
    }
  }

  /** Written-entity id: the created/updated/deleted row from the response. */
  private extractEntityId(path: string, payload: SuccessEnvelope): string | null {
    const data = payload && typeof payload === 'object' ? (payload.data as { id?: unknown }) : null;
    if (data && typeof data.id === 'string') {
      return data.id;
    }
    // Fallback for payloads without an id: the id in the URL, when UUID-shaped.
    const candidate = this.lastSegment(path);
    return candidate && UUID_PATTERN.test(candidate) ? candidate : null;
  }

  /** First path segment after `/manage/` (e.g. `students`, `route-assignments`). */
  private resourceOf(path: string): string | null {
    const match = /\/manage\/([^/?#]+)/.exec(path);
    return match ? match[1] : null;
  }
  private lastSegment(path: string): string | null {
    const segments = path.split('?')[0].split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1] : null;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
