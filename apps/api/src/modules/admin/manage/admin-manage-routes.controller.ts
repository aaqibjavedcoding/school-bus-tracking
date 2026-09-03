import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { RateLimit } from '../../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { RoutesService } from '../../../modules/routes/routes.service';
import { CreateRouteDto } from '../../../modules/routes/dto/create-route.dto';
import { ListRoutesQueryDto } from '../../../modules/routes/dto/list-routes-query.dto';
import { ReorderRouteStopsDto } from '../../../modules/routes/dto/reorder-route-stops.dto';
import { UpdateRouteDto } from '../../../modules/routes/dto/update-route.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Assisted management of a school's routes, including their ordered stop
 * manifests — reuses {@link RoutesService} untouched.
 *
 * Stop ordering (`PUT …/routes/:id/stops`) is transactional in the service:
 * the whole renumbering is one `UPDATE`, so a concurrent assisted edit and a
 * school-admin edit can never interleave into a corrupted sequence.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/routes`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageRoutesController {
  constructor(private readonly routesService: RoutesService) {}

  /** `POST …/manage/routes` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string, @Body() dto: CreateRouteDto) {
    return this.routesService.create(schoolId, dto);
  }

  /** `GET …/manage/routes` — paginated, searchable. */
  @Get()
  @RateLimit('read_heavy')
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListRoutesQueryDto,
  ) {
    return this.routesService.findAll(schoolId, query);
  }

  /** `GET …/manage/routes/:id` */
  @Get(':id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.routesService.findOne(schoolId, id);
  }

  /** `GET …/manage/routes/:id/details` — enriched route + ordered stops. */
  @Get(':id/details')
  getDetails(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.routesService.getDetails(schoolId, id);
  }

  /** `PATCH …/manage/routes/:id` */
  @Patch(':id')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateRouteDto,
  ) {
    return this.routesService.update(schoolId, id, dto);
  }

  /** `DELETE …/manage/routes/:id` — paranoid soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.routesService.remove(schoolId, id);
  }

  /** `GET …/manage/routes/:id/stops` — ordered stop manifest. */
  @Get(':id/stops')
  findRouteStops(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.routesService.findRouteStops(schoolId, id);
  }

  /** `PUT …/manage/routes/:id/stops` — renumber the route's stops 1..N. */
  @Put(':id/stops')
  @HttpCode(HttpStatus.OK)
  reorderRouteStops(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: ReorderRouteStopsDto,
  ) {
    return this.routesService.reorderRouteStops(schoolId, id, dto);
  }
}
