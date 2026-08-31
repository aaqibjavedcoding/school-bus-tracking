import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  EmergencyActiveListResponse,
  EmergencyEventListResponse,
  EmergencyEventResponse,
  EmergencyStatus,
  UserRole,
} from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import type { TenantRequestUser } from '../../common/guards';
import {
  CancelEmergencyDto,
  ListEmergenciesQueryDto,
  SosDto,
  UpdateEmergencyStatusDto,
} from './dto';
import { EmergenciesService } from './emergencies.service';

/**
 * Emergency / SOS endpoints (`/api/v1/emergencies`).
 *
 * One controller serves both sides of the flow and the role rules are declared
 * per handler, so the guard metadata can never drift from the behaviour:
 *
 * - `POST /sos` — **crew only** (DRIVER / CONDUCTOR) raises the alarm.
 * - `GET /`, `GET /active`, `GET /:id`, `PATCH /:id/status` — **school admin
 *   only**: the school sees and handles its incidents.
 * - `GET /mine`, `PATCH /:id/cancel` — **crew only**, restricted to the
 *   caller's own events by the service (a crew member may retract their own
 *   alarm but never resolve somebody else's).
 *
 * `school_id` is never accepted from a client: it always comes from the
 * verified JWT, and every query is pinned with it.
 */
@Controller('emergencies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmergenciesController {
  constructor(private readonly emergencies: EmergenciesService) {}

  /**
   * `POST /api/v1/emergencies/sos`
   *
   * Records the alarm with the server clock and broadcasts it to the school's
   * Socket.IO room. The trip is resolved from the caller's own roster.
   */
  @Post('sos')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.DRIVER, UserRole.CONDUCTOR)
  async raiseSos(
    @CurrentUser() user: TenantRequestUser,
    @Body() dto: SosDto,
  ): Promise<EmergencyEventResponse> {
    return this.emergencies.raiseSos(user, dto);
  }

  /** `GET /api/v1/emergencies/mine` — the crew member's own SOS history. */
  @Get('mine')
  @Roles(UserRole.DRIVER, UserRole.CONDUCTOR)
  async listMine(
    @CurrentUser() user: TenantRequestUser,
    @Query() query: ListEmergenciesQueryDto,
  ): Promise<EmergencyEventListResponse> {
    return this.emergencies.listMine(user, query);
  }

  /**
   * `PATCH /api/v1/emergencies/:id/cancel`
   *
   * Retracts an alarm the caller raised by mistake. Only the owner may do it,
   * and only while the event is still open.
   *
   * The target status is fixed by the route (`CANCELLED`) and the body accepts
   * a note only — a crew member can never resolve or acknowledge on behalf of
   * the school, and a smuggled `status` is rejected with 400.
   */
  @Patch(':id/cancel')
  @Roles(UserRole.DRIVER, UserRole.CONDUCTOR)
  async cancelOwn(
    @CurrentUser() user: TenantRequestUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: CancelEmergencyDto,
  ): Promise<EmergencyEventResponse> {
    return this.emergencies.updateStatus(
      user,
      id,
      { status: EmergencyStatus.CANCELLED, note: dto.note ?? null },
      { requireOwnership: true },
    );
  }

  /**
   * `GET /api/v1/emergencies/active`
   *
   * Everything still needing attention (OPEN / ACKNOWLEDGED) — the admin
   * cockpit view. Declared before `GET /:id` so Nest resolves the literal
   * path first.
   */
  @Get('active')
  @Roles(UserRole.SCHOOL_ADMIN)
  async listActive(
    @CurrentUser('school_id') schoolId: string,
  ): Promise<EmergencyActiveListResponse> {
    return this.emergencies.listActive(schoolId);
  }

  /** `GET /api/v1/emergencies` — the school's incident history, newest first. */
  @Get()
  @Roles(UserRole.SCHOOL_ADMIN)
  async findAll(
    @CurrentUser('school_id') schoolId: string,
    @Query() query: ListEmergenciesQueryDto,
  ): Promise<EmergencyEventListResponse> {
    return this.emergencies.listForSchool(schoolId, query);
  }

  /** `GET /api/v1/emergencies/:id` */
  @Get(':id')
  @Roles(UserRole.SCHOOL_ADMIN)
  async findOne(
    @CurrentUser('school_id') schoolId: string,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
  ): Promise<EmergencyEventResponse> {
    return this.emergencies.findOne(schoolId, id);
  }

  /**
   * `PATCH /api/v1/emergencies/:id/status`
   *
   * Acknowledges, resolves or cancels an incident of the school. Illegal
   * transitions (for example reopening a resolved event) are rejected.
   */
  @Patch(':id/status')
  @Roles(UserRole.SCHOOL_ADMIN)
  async updateStatus(
    @CurrentUser() user: TenantRequestUser,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST }))
    id: string,
    @Body() dto: UpdateEmergencyStatusDto,
  ): Promise<EmergencyEventResponse> {
    return this.emergencies.updateStatus(user, id, dto);
  }
}
