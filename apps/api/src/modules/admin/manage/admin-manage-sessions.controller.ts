import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AssistedSessionCurrentResponse,
  AssistedSessionEndResponse,
  AssistedSessionStartResponse,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import type { AssistedManagementSession } from '../../../database/models';
import { AssistedSessionService } from './assisted-session.service';
import {
  ASSISTED_MANAGEMENT_CAPABILITIES,
  MANAGED_SCHOOL_PARAM,
  type ManagedSchoolContext,
} from './admin-manage.constants';
import { AssistedAllowWhenInactive, ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

interface ManagedRequest {
  managedSchool?: ManagedSchoolContext;
  user?: { id?: string };
  ip?: string | null;
}

/**
 * Assisted-management session lifecycle.
 *
 * `POST …/manage/session`        — the Super Admin enters the school.
 * `GET  …/manage/session/current` — the banner restore path on page load.
 * `POST …/manage/session/end`     — the Super Admin exits.
 *
 * These are the only assisted-management endpoints that stay usable while the
 * managed school is deactivated: a platform operator may open a read-only
 * session on a suspended tenant, exactly as the rest of the platform console
 * remains reachable. Mutating endpoints are blocked by
 * {@link ManagedSchoolGuard} until the school is activated again.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/session`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageSessionsController {
  constructor(private readonly sessions: AssistedSessionService) {}

  /** Enter the school: open (or supersede) the actor's assisted session. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AssistedAllowWhenInactive()
  async start(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) _schoolId: string,
    @Req() request: ManagedRequest,
  ): Promise<AssistedSessionStartResponse> {
    const { school, actor, ip } = this.requireContext(request);
    const session = await this.sessions.start(school, actor, { ip_address: ip });
    return {
      session: this.toResponse(session),
      school: this.toSchoolSummary(school),
      capabilities: [...ASSISTED_MANAGEMENT_CAPABILITIES],
    };
  }

  /** Current open session for the actor in this school (or none). */
  @Get('current')
  @AssistedAllowWhenInactive()
  async current(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) _schoolId: string,
    @Req() request: ManagedRequest,
  ): Promise<AssistedSessionCurrentResponse> {
    const { school, actor } = this.requireContext(request);
    const session = await this.sessions.findOpen(school.id, actor.userId);
    return {
      session: session ? this.toResponse(session) : null,
      school: this.toSchoolSummary(school),
    };
  }

  /** Exit the school: close the open session as `exit` (idempotent). */
  @Post('end')
  @HttpCode(HttpStatus.OK)
  @AssistedAllowWhenInactive()
  async end(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) _schoolId: string,
    @Req() request: ManagedRequest,
  ): Promise<AssistedSessionEndResponse> {
    const { school, actor } = this.requireContext(request);
    const session = await this.sessions.end(school, actor);
    return {
      session: session ? this.toResponse(session) : null,
      school: this.toSchoolSummary(school),
    };
  }

  private requireContext(request: ManagedRequest): {
    school: ManagedSchoolContext;
    actor: { userId: string };
    ip: string | null;
  } {
    if (!request.managedSchool || !request.user?.id) {
      // Unreachable behind JwtAuthGuard + ManagedSchoolGuard.
      throw new Error('Assisted-management request context is missing');
    }
    return {
      school: request.managedSchool,
      actor: { userId: request.user.id },
      ip: this.clientIp(request),
    };
  }

  private toSchoolSummary(school: ManagedSchoolContext) {
    return { id: school.id, name: school.name, code: school.code, is_active: school.is_active };
  }

  private toResponse(session: AssistedManagementSession) {
    return {
      id: session.id,
      school_id: session.school_id,
      actor_user_id: session.actor_user_id,
      started_at: session.started_at.toISOString(),
      ended_at: session.ended_at ? session.ended_at.toISOString() : null,
      end_reason: session.end_reason,
    };
  }

  /** Best-effort client IP (socket address; proxy chains may replace it). */
  private clientIp(request: ManagedRequest): string | null {
    const raw = request.ip ?? null;
    if (!raw) return null;
    // Normalise IPv6-mapped IPv4 and trim port suffixes so the column stays comparable.
    return raw.replace('::ffff:', '').split('%')[0].slice(0, 45);
  }
}
