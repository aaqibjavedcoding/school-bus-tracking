import { Controller, Get, HttpStatus, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard, TenantRequestUser } from '../../common/guards';
import { ParentPortalService } from './parent-portal.service';

/** Reusable 400-on-failure UUID pipe for the student path parameter. */
const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Read-only Parent Portal surface (`/api/v1/parent/*`).
 *
 * Reachable only by an authenticated `PARENT`. Every handler takes the tenant
 * and the parent identity exclusively from the verified JWT claims
 * (`@CurrentUser()`) — a client-supplied `parent_id` / `school_id` is neither
 * read nor trusted. Students are returned only when the JWT subject holds an
 * active guardian link to them inside the JWT tenant; anything else is a
 * generic 404. There are intentionally no write endpoints here: attendance,
 * trips, buses, routes and staff stay managed by the existing admin/crew
 * surfaces.
 */
@Controller('parent')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PARENT)
export class ParentPortalController {
  constructor(private readonly parentPortalService: ParentPortalService) {}

  /** `GET /api/v1/parent/dashboard` — parent profile + today's view of children. */
  @Get('dashboard')
  getDashboard(@CurrentUser() actor: TenantRequestUser) {
    return this.parentPortalService.getDashboard(actor);
  }

  /** `GET /api/v1/parent/children` — the authenticated parent's own children. */
  @Get('children')
  listChildren(@CurrentUser() actor: TenantRequestUser) {
    return this.parentPortalService.listChildren(actor);
  }

  /** `GET /api/v1/parent/children/:id` — one linked child with crew of today. */
  @Get('children/:id')
  getChild(@CurrentUser() actor: TenantRequestUser, @Param('id', uuidParam()) id: string) {
    return this.parentPortalService.getChild(actor, id);
  }

  /** `GET /api/v1/parent/children/:id/today` — today's trip + attendance. */
  @Get('children/:id/today')
  getChildToday(@CurrentUser() actor: TenantRequestUser, @Param('id', uuidParam()) id: string) {
    return this.parentPortalService.getChildToday(actor, id);
  }

  /**
   * `GET /api/v1/parent/children/:id/tracking`
   *
   * The child's active/current trip with its route stops, crew and the latest
   * verified GPS fix (or `null` while no location exists — never fabricated).
   */
  @Get('children/:id/tracking')
  getChildTracking(@CurrentUser() actor: TenantRequestUser, @Param('id', uuidParam()) id: string) {
    return this.parentPortalService.getChildTracking(actor, id);
  }
}
