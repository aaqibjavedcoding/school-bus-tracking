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
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../../common/decorators';
import { RateLimit } from '../../../common/rate-limit';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { StopsService } from '../../../modules/stops/stops.service';
import { CreateStopDto } from '../../../modules/stops/dto/create-stop.dto';
import { ListStopsQueryDto } from '../../../modules/stops/dto/list-stops-query.dto';
import { UpdateStopDto } from '../../../modules/stops/dto/update-stop.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/**
 * Assisted management of a school's stops.
 *
 * {@link StopsService} verifies that the referenced route belongs to the
 * managed school before every write — a stop can never be attached to another
 * tenant's route through this surface.
 */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/stops`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageStopsController {
  constructor(private readonly stopsService: StopsService) {}

  /** `POST …/manage/stops` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string, @Body() dto: CreateStopDto) {
    return this.stopsService.create(schoolId, dto);
  }

  /** `GET …/manage/stops` — paginated, filterable by route. */
  @Get()
  @RateLimit('read_heavy')
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListStopsQueryDto,
  ) {
    return this.stopsService.findAll(schoolId, query);
  }

  /** `GET …/manage/stops/:id` */
  @Get(':id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.stopsService.findOne(schoolId, id);
  }

  /** `PATCH …/manage/stops/:id` */
  @Patch(':id')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateStopDto,
  ) {
    return this.stopsService.update(schoolId, id, dto);
  }

  /** `DELETE …/manage/stops/:id` — paranoid soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.stopsService.remove(schoolId, id);
  }
}
