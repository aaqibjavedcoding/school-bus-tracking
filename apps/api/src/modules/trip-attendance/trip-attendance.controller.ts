import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard, TenantRequestUser } from '../../common/guards';
import { TripAttendanceService } from './trip-attendance.service';
import { ListTripStudentsQueryDto } from './dto/list-trip-students-query.dto';

/** Reusable 400-on-failure UUID pipe for the two path parameters. */
const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Trip student attendance endpoints.
 *
 * The routes are nested under the trip because a manifest only exists in the
 * context of one run: `/trips/:tripId/students[...]`. Nothing about ownership
 * is taken from the request — the tenant comes from the verified JWT, the
 * route, stops and students are derived from the trip, and the acting user is
 * the JWT subject.
 *
 * Reading is open to the school admin, the rostered crew and (for their own
 * children only) parents; recording boarding and drop events is restricted to
 * the crew and the school admin.
 */
@Controller('trips/:tripId/students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR, UserRole.PARENT)
export class TripAttendanceController {
  constructor(private readonly tripAttendanceService: TripAttendanceService) {}

  /** `GET /api/v1/trips/:tripId/students` — ordered manifest of the trip. */
  @Get()
  async findAll(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
    @Query() query: ListTripStudentsQueryDto,
  ) {
    return this.tripAttendanceService.getManifest(actor, tripId, query);
  }

  /** `GET /api/v1/trips/:tripId/students/:studentId` — one manifest entry. */
  @Get(':studentId')
  async findOne(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
    @Param('studentId', uuidParam()) studentId: string,
  ) {
    return this.tripAttendanceService.getStudent(actor, tripId, studentId);
  }

  /**
   * `POST /api/v1/trips/:tripId/students/:studentId/board`
   *
   * Body-less on purpose: the crew member is the JWT subject and the boarding
   * time is the server clock, so there is nothing a client could contribute.
   */
  @Post(':studentId/board')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR)
  @HttpCode(HttpStatus.OK)
  async board(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
    @Param('studentId', uuidParam()) studentId: string,
  ) {
    return this.tripAttendanceService.board(actor, tripId, studentId);
  }

  /** `POST /api/v1/trips/:tripId/students/:studentId/drop` — body-less too. */
  @Post(':studentId/drop')
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR)
  @HttpCode(HttpStatus.OK)
  async drop(
    @CurrentUser() actor: TenantRequestUser,
    @Param('tripId', uuidParam()) tripId: string,
    @Param('studentId', uuidParam()) studentId: string,
  ) {
    return this.tripAttendanceService.drop(actor, tripId, studentId);
  }
}
