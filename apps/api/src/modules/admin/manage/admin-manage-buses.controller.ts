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
import { BusesService } from '../../../modules/buses/buses.service';
import { CreateBusDto } from '../../../modules/buses/dto/create-bus.dto';
import { ListBusesQueryDto } from '../../../modules/buses/dto/list-buses-query.dto';
import { UpdateBusDto } from '../../../modules/buses/dto/update-bus.dto';
import { AssistedMutationAuditInterceptor } from './assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from './admin-manage.constants';
import { ManagedSchoolGuard } from './managed-school.guard';

const uuidParam = () => new ParseUUIDPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST });

/** Assisted management of a school's buses — reuses {@link BusesService}. */
@Controller(`admin/schools/:${MANAGED_SCHOOL_PARAM}/manage/buses`)
@UseGuards(JwtAuthGuard, RolesGuard, ManagedSchoolGuard)
@UseInterceptors(AssistedMutationAuditInterceptor)
@Roles(UserRole.SUPER_ADMIN)
export class AdminManageBusesController {
  constructor(private readonly busesService: BusesService) {}

  /** `POST …/manage/buses` */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string, @Body() dto: CreateBusDto) {
    return this.busesService.create(schoolId, dto);
  }

  /** `GET …/manage/buses` — paginated, searchable. */
  @Get()
  @RateLimit('read_heavy')
  findAll(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Query() query: ListBusesQueryDto,
  ) {
    return this.busesService.findAll(schoolId, query);
  }

  /** `GET …/manage/buses/:id` */
  @Get(':id')
  findOne(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.busesService.findOne(schoolId, id);
  }

  /** `PATCH …/manage/buses/:id` */
  @Patch(':id')
  update(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
    @Body() dto: UpdateBusDto,
  ) {
    return this.busesService.update(schoolId, id, dto);
  }

  /** `DELETE …/manage/buses/:id` — paranoid soft delete. */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(
    @Param(MANAGED_SCHOOL_PARAM, uuidParam()) schoolId: string,
    @Param('id', uuidParam()) id: string,
  ) {
    return this.busesService.remove(schoolId, id);
  }
}
