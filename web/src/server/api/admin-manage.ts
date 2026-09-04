/**
 * Endpoint definitions for the `admin/manage` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import {
  bufferFileResponse,
  parseUploadedSpreadsheet,
  streamFileResponse,
  type UploadedSpreadsheet,
} from '../http/file-response';
import { BadRequestException } from '../framework';
import { ASSISTED_MANAGEMENT_CAPABILITIES } from '../modules/admin/manage/admin-manage.constants';
import type { ManagedSchoolContext } from '../modules/admin/manage/admin-manage.constants';
import type { AssistedManagementSession } from '../database/models';
import { ReportQueryDto } from '../modules/reports/dto/report-query.dto';
import { ImportTemplateQueryDto, ImportUploadDto } from '../modules/data-transfer/dto/import.dto';
import { DataFileFormat, EXPORT_DATASET_LABELS, EXPORT_DATASET_VALUES, ImportMode, ImportModule, StaffRole, UserRole } from '@school-bus-tracking/shared-types';
import { RouteAssignmentsService } from '../modules/assignments/assignments.service';
import { CreateRouteAssignmentDto } from '../modules/assignments/dto/create-route-assignment.dto';
import { ListRouteAssignmentsQueryDto } from '../modules/assignments/dto/list-route-assignments-query.dto';
import { UpdateRouteAssignmentDto } from '../modules/assignments/dto/update-route-assignment.dto';
import { AssistedMutationAuditInterceptor } from '../modules/admin/manage/assisted-mutation-audit.interceptor';
import { MANAGED_SCHOOL_PARAM } from '../modules/admin/manage/admin-manage.constants';
import { ManagedSchoolGuard } from '../modules/admin/manage/managed-school.guard';
import { BusesService } from '../modules/buses/buses.service';
import { CreateBusDto } from '../modules/buses/dto/create-bus.dto';
import { ListBusesQueryDto } from '../modules/buses/dto/list-buses-query.dto';
import { UpdateBusDto } from '../modules/buses/dto/update-bus.dto';
import { IMPORT_ALLOWED_EXTENSIONS, IMPORT_ALLOWED_MIME_TYPES, MAX_IMPORT_FILE_BYTES, sanitizeFileName } from '../modules/data-transfer/excel/excel.util';
import { ExportQueryDto } from '../modules/data-transfer/dto/export.dto';
import { AdminManageExportDatasetParamDto, AdminManageImportModuleParamDto, AdminManageReportParamDto } from '../modules/admin/manage/admin-manage.dto';
import { ExportService } from '../modules/data-transfer/export/export.service';
import { AssistedSessionService } from '../modules/admin/manage/assisted-session.service';
import { AUDIT_ACTIONS, AUDIT_CONTEXT_ASSISTED_MANAGEMENT, AUDIT_ENTITY_TYPES, AuditService } from '../modules/audit';
import { IMPORT_FILE_REQUIRED_MESSAGE, IMPORT_FILE_TOO_LARGE_MESSAGE, IMPORT_FILE_TYPE_MESSAGE } from '../modules/data-transfer/data-transfer.constants';
import { ListImportJobsQueryDto } from '../modules/data-transfer/dto/import.dto';
import { ImportHistoryService } from '../modules/data-transfer/import/import-history.service';
import { ImportTemplateService } from '../modules/data-transfer/import/import-template.service';
import { ImportService } from '../modules/data-transfer/import/import.service';
import { ParentGuardiansService } from '../modules/parents/parent-guardians.service';
import { ParentsService } from '../modules/parents/parents.service';
import { CreateParentDto } from '../modules/parents/dto/create-parent.dto';
import { CreateParentStudentRelationshipDto } from '../modules/parents/dto/create-parent-student-relationship.dto';
import { ListParentsQueryDto } from '../modules/parents/dto/list-parents-query.dto';
import { UpdateParentDto } from '../modules/parents/dto/update-parent.dto';
import { UpdateParentStudentRelationshipDto } from '../modules/parents/dto/update-parent-student-relationship.dto';
import { ReportsService } from '../modules/reports/reports.service';
import { RoutesService } from '../modules/routes/routes.service';
import { CreateRouteDto } from '../modules/routes/dto/create-route.dto';
import { ListRoutesQueryDto } from '../modules/routes/dto/list-routes-query.dto';
import { ReorderRouteStopsDto } from '../modules/routes/dto/reorder-route-stops.dto';
import { UpdateRouteDto } from '../modules/routes/dto/update-route.dto';
import { StaffService } from '../modules/staff/staff.service';
import { CreateStaffDto } from '../modules/staff/dto/create-staff.dto';
import { ListStaffQueryDto } from '../modules/staff/dto/list-staff-query.dto';
import { UpdateStaffDto } from '../modules/staff/dto/update-staff.dto';
import { StopsService } from '../modules/stops/stops.service';
import { CreateStopDto } from '../modules/stops/dto/create-stop.dto';
import { ListStopsQueryDto } from '../modules/stops/dto/list-stops-query.dto';
import { UpdateStopDto } from '../modules/stops/dto/update-stop.dto';
import { CreateStudentGuardianDto } from '../modules/parents/dto/create-student-guardian.dto';
import { StudentsService } from '../modules/students/students.service';
import { CreateStudentDto } from '../modules/students/dto/create-student.dto';
import { ListStudentsQueryDto } from '../modules/students/dto/list-students-query.dto';
import { UpdateStudentDto } from '../modules/students/dto/update-student.dto';

/** `POST /api/v1/admin/schools/:schoolId/manage/route-assignments` */
export const postAdminSchoolsBySchoolIdManageRouteassignments: EndpointDefinition<CreateRouteAssignmentDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRouteAssignmentDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().routeAssignments().create(schoolId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/route-assignments` */
export const getAdminSchoolsBySchoolIdManageRouteassignments: EndpointDefinition<unknown, ListRouteAssignmentsQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListRouteAssignmentsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().routeAssignments().findAll(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/route-assignments/:id` */
export const getAdminSchoolsBySchoolIdManageRouteassignmentsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/route-assignments/:id` */
export const patchAdminSchoolsBySchoolIdManageRouteassignmentsById: EndpointDefinition<UpdateRouteAssignmentDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRouteAssignmentDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routeAssignments().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/route-assignments/:id` */
export const deleteAdminSchoolsBySchoolIdManageRouteassignmentsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().routeAssignments().remove(schoolId, id);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/buses` */
export const postAdminSchoolsBySchoolIdManageBuses: EndpointDefinition<CreateBusDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateBusDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().buses().create(schoolId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/buses` */
export const getAdminSchoolsBySchoolIdManageBuses: EndpointDefinition<unknown, ListBusesQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListBusesQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().buses().findAll(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/buses/:busId` */
export const getAdminSchoolsBySchoolIdManageBusesById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['busId']);
    return container().buses().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/buses/:busId` */
export const patchAdminSchoolsBySchoolIdManageBusesById: EndpointDefinition<UpdateBusDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateBusDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['busId']);
    const dto = body;
    return container().buses().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/buses/:busId` */
export const deleteAdminSchoolsBySchoolIdManageBusesById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['busId']);
    return container().buses().remove(schoolId, id);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/exports` */
export const getAdminSchoolsBySchoolIdManageExports: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return {
    items: EXPORT_DATASET_VALUES.map((dataset) => ({
    dataset,
    label: EXPORT_DATASET_LABELS[dataset],
    })),
    };
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/imports/modules` */
export const getAdminSchoolsBySchoolIdManageImportsModules: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return container().importTemplates().listModules();
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/imports/history` */
export const getAdminSchoolsBySchoolIdManageImportsHistory: EndpointDefinition<unknown, ListImportJobsQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListImportJobsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().importHistory().list(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/imports/history/:id` */
export const getAdminSchoolsBySchoolIdManageImportsHistoryById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().importHistory().findOne(schoolId, id);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/parents` */
export const postAdminSchoolsBySchoolIdManageParents: EndpointDefinition<CreateParentDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateParentDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().parents().create(schoolId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/parents` */
export const getAdminSchoolsBySchoolIdManageParents: EndpointDefinition<unknown, ListParentsQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListParentsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().parents().findAll(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/parents/:parentId` */
export const getAdminSchoolsBySchoolIdManageParentsByParentId: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    return container().parents().findOne(schoolId, parentId);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/parents/:parentId` */
export const patchAdminSchoolsBySchoolIdManageParentsByParentId: EndpointDefinition<UpdateParentDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateParentDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    return container().parents().update(schoolId, parentId, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/parents/:parentId` */
export const deleteAdminSchoolsBySchoolIdManageParentsByParentId: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    return container().parents().remove(schoolId, parentId);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/parents/:parentId/students` */
export const postAdminSchoolsBySchoolIdManageParentsByParentIdStudents: EndpointDefinition<CreateParentStudentRelationshipDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateParentStudentRelationshipDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    return container().parentGuardians().createForParent(schoolId, parentId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/parents/:parentId/students` */
export const getAdminSchoolsBySchoolIdManageParentsByParentIdStudents: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    return container().parentGuardians().listForParent(schoolId, parentId);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/parents/:parentId/students/:studentId` */
export const patchAdminSchoolsBySchoolIdManageParentsByParentIdStudentsByStudentId: EndpointDefinition<UpdateParentStudentRelationshipDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateParentStudentRelationshipDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    const studentId = parseUuidParam(params['studentId']);
    const dto = body;
    return container().parentGuardians().updateForParent(schoolId, parentId, studentId, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/parents/:parentId/students/:studentId` */
export const deleteAdminSchoolsBySchoolIdManageParentsByParentIdStudentsByStudentId: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const parentId = parseUuidParam(params['parentId']);
    const studentId = parseUuidParam(params['studentId']);
    return container().parentGuardians().removeForParent(schoolId, parentId, studentId);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/reports` */
export const getAdminSchoolsBySchoolIdManageReports: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return container().reports().catalogue();
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/reports/overview` */
export const getAdminSchoolsBySchoolIdManageReportsOverview: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'report_read',
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = params['schoolId'] as string;
    return container().reports().overview(schoolId);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/reports/:report` */
export const getAdminSchoolsBySchoolIdManageReportsByReport: EndpointDefinition<unknown, ReportQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'report_read',
  status: HttpStatus.OK,
  queryType: ReportQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = params['schoolId'] as string;
    const routeParams = await validateDto(AdminManageReportParamDto, params, 'param');
    return container().reports().run(schoolId, routeParams.report, query);
  },};

/** `POST /api/v1/admin/schools/:schoolId/manage/routes` */
export const postAdminSchoolsBySchoolIdManageRoutes: EndpointDefinition<CreateRouteDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateRouteDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().routes().create(schoolId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/routes` */
export const getAdminSchoolsBySchoolIdManageRoutes: EndpointDefinition<unknown, ListRoutesQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListRoutesQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().routes().findAll(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/routes/:id` */
export const getAdminSchoolsBySchoolIdManageRoutesById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().routes().findOne(schoolId, id);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/routes/:id/details` */
export const getAdminSchoolsBySchoolIdManageRoutesByIdDetails: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().routes().getDetails(schoolId, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/routes/:id` */
export const patchAdminSchoolsBySchoolIdManageRoutesById: EndpointDefinition<UpdateRouteDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateRouteDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routes().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/routes/:id` */
export const deleteAdminSchoolsBySchoolIdManageRoutesById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().routes().remove(schoolId, id);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/routes/:id/stops` */
export const getAdminSchoolsBySchoolIdManageRoutesByIdStops: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().routes().findRouteStops(schoolId, id);
  },
};

/** `PUT /api/v1/admin/schools/:schoolId/manage/routes/:id/stops` */
export const putAdminSchoolsBySchoolIdManageRoutesByIdStops: EndpointDefinition<ReorderRouteStopsDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: ReorderRouteStopsDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().routes().reorderRouteStops(schoolId, id, dto);
  },};

/** `POST /api/v1/admin/schools/:schoolId/manage/drivers` */
export const postAdminSchoolsBySchoolIdManageDrivers: EndpointDefinition<CreateStaffDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStaffDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().staff().create(schoolId, UserRole.DRIVER, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/drivers` */
export const getAdminSchoolsBySchoolIdManageDrivers: EndpointDefinition<unknown, ListStaffQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStaffQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().staff().findAll(schoolId, UserRole.DRIVER, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/drivers/:driverId` */
export const getAdminSchoolsBySchoolIdManageDriversById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['driverId']);
    return container().staff().findOne(schoolId, UserRole.DRIVER, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/drivers/:driverId` */
export const patchAdminSchoolsBySchoolIdManageDriversById: EndpointDefinition<UpdateStaffDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStaffDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['driverId']);
    const dto = body;
    return container().staff().update(schoolId, UserRole.DRIVER, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/drivers/:driverId` */
export const deleteAdminSchoolsBySchoolIdManageDriversById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['driverId']);
    return container().staff().remove(schoolId, UserRole.DRIVER, id);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/conductors` */
export const postAdminSchoolsBySchoolIdManageConductors: EndpointDefinition<CreateStaffDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStaffDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().staff().create(schoolId, UserRole.CONDUCTOR, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/conductors` */
export const getAdminSchoolsBySchoolIdManageConductors: EndpointDefinition<unknown, ListStaffQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStaffQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().staff().findAll(schoolId, UserRole.CONDUCTOR, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/conductors/:id` */
export const getAdminSchoolsBySchoolIdManageConductorsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().staff().findOne(schoolId, UserRole.CONDUCTOR, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/conductors/:id` */
export const patchAdminSchoolsBySchoolIdManageConductorsById: EndpointDefinition<UpdateStaffDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStaffDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().staff().update(schoolId, UserRole.CONDUCTOR, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/conductors/:id` */
export const deleteAdminSchoolsBySchoolIdManageConductorsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().staff().remove(schoolId, UserRole.CONDUCTOR, id);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/stops` */
export const postAdminSchoolsBySchoolIdManageStops: EndpointDefinition<CreateStopDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStopDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().stops().create(schoolId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/stops` */
export const getAdminSchoolsBySchoolIdManageStops: EndpointDefinition<unknown, ListStopsQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStopsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().stops().findAll(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/stops/:id` */
export const getAdminSchoolsBySchoolIdManageStopsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().stops().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/stops/:id` */
export const patchAdminSchoolsBySchoolIdManageStopsById: EndpointDefinition<UpdateStopDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStopDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().stops().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/stops/:id` */
export const deleteAdminSchoolsBySchoolIdManageStopsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['id']);
    return container().stops().remove(schoolId, id);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/students/:studentId/guardians` */
export const postAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardians: EndpointDefinition<CreateStudentGuardianDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStudentGuardianDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const studentId = parseUuidParam(params['studentId']);
    const dto = body;
    return container().parentGuardians().createForStudent(schoolId, studentId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/students/:studentId/guardians` */
export const getAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardians: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const studentId = parseUuidParam(params['studentId']);
    return container().parentGuardians().listForStudent(schoolId, studentId);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/students/:studentId/guardians/:parentId` */
export const patchAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardiansByParentId: EndpointDefinition<UpdateParentStudentRelationshipDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateParentStudentRelationshipDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const studentId = parseUuidParam(params['studentId']);
    const parentId = parseUuidParam(params['parentId']);
    const dto = body;
    return container().parentGuardians().updateForStudent(schoolId, studentId, parentId, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/students/:studentId/guardians/:parentId` */
export const deleteAdminSchoolsBySchoolIdManageStudentsByStudentIdGuardiansByParentId: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const studentId = parseUuidParam(params['studentId']);
    const parentId = parseUuidParam(params['parentId']);
    return container().parentGuardians().removeForStudent(schoolId, studentId, parentId);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/students` */
export const postAdminSchoolsBySchoolIdManageStudents: EndpointDefinition<CreateStudentDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateStudentDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().students().create(schoolId, dto);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/students` */
export const getAdminSchoolsBySchoolIdManageStudents: EndpointDefinition<unknown, ListStudentsQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListStudentsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().students().findAll(schoolId, query);
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/students/:studentId` */
export const getAdminSchoolsBySchoolIdManageStudentsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['studentId']);
    return container().students().findOne(schoolId, id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId/manage/students/:studentId` */
export const patchAdminSchoolsBySchoolIdManageStudentsById: EndpointDefinition<UpdateStudentDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateStudentDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['studentId']);
    const dto = body;
    return container().students().update(schoolId, id, dto);
  },};

/** `DELETE /api/v1/admin/schools/:schoolId/manage/students/:studentId` */
export const deleteAdminSchoolsBySchoolIdManageStudentsById: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const id = parseUuidParam(params['studentId']);
    return container().students().remove(schoolId, id);
  },
};

/* -------------------------------------------------------------------------
 * Assisted exports / imports / reports / session lifecycle.
 *
 * These handlers stream files, read uploads or need the guarded request
 * context, so they are written by hand rather than generated. Every one of
 * them still threads the *route-derived* school id — resolved and validated by
 * ManagedSchoolGuard — into the same tenant services the school admin uses,
 * and stamps the open assisted session id onto the audit trail.
 * ---------------------------------------------------------------------- */

/** The open assisted session, stamped onto every audited assisted operation. */
async function assistedContext(schoolId: string, userId: string) {
  return {
    assisted_session_id: await container().assistedSession().findOpenSessionId(schoolId, userId),
  };
}

/** Upload envelope validation, identical to the tenant import route. */
function requireSpreadsheet(file: UploadedSpreadsheet | undefined): {
  originalName: string;
  buffer: Buffer;
} {
  if (!file || !file.buffer || file.buffer.length === 0) {
    throw new BadRequestException(IMPORT_FILE_REQUIRED_MESSAGE);
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new BadRequestException(IMPORT_FILE_TOO_LARGE_MESSAGE);
  }
  const name = sanitizeFileName(file.originalname, 'import');
  const extension = name.toLowerCase().slice(name.lastIndexOf('.'));
  if (!IMPORT_ALLOWED_EXTENSIONS.includes(extension as '.xlsx' | '.csv')) {
    throw new BadRequestException(IMPORT_FILE_TYPE_MESSAGE);
  }
  if (!IMPORT_ALLOWED_MIME_TYPES.has(file.mimetype ?? '')) {
    throw new BadRequestException(IMPORT_FILE_TYPE_MESSAGE);
  }
  return { originalName: name, buffer: file.buffer };
}

/** `GET /api/v1/admin/schools/:schoolId/manage/exports/:dataset` */
export const getAdminSchoolsBySchoolIdManageExportsByDataset: EndpointDefinition<unknown, ExportQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'data_export',
  status: HttpStatus.OK,
  queryType: ExportQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = params[MANAGED_SCHOOL_PARAM];
    const userId = user.id;
    const routeParams = await validateDto(AdminManageExportDatasetParamDto, params, 'param');
    const typedQuery = query;

    const sessionId = await container().assistedSession().findOpenSessionId(schoolId, userId);
    const plan = await container()
      .exports()
      .prepare(schoolId, userId, routeParams.dataset, typedQuery, {
        assisted_session_id: sessionId,
      });

    const format = typedQuery.format ?? DataFileFormat.XLSX;
    return streamFileResponse({
      contentType: plan.contentType,
      fileName: sanitizeFileName(plan.fileName, `export.${format}`),
      totalRecords: plan.total,
      produce: (sink) => plan.stream(sink),
    });
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/imports/history/:id/error-file` */
export const getAdminSchoolsBySchoolIdManageImportsHistoryByIdErrorfile: EndpointDefinition = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params }) => {
    const schoolId = parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const id = parseUuidParam(params['id'], '4');
    const context = await assistedContext(schoolId, user.id);
    const file = await container()
      .importHistory()
      .buildErrorFile(schoolId, user.id, id, context);
    return bufferFileResponse(
      file.buffer,
      sanitizeFileName(file.fileName, 'download.xlsx'),
      DataFileFormat.XLSX,
    );
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/imports/:module/template` */
export const getAdminSchoolsBySchoolIdManageImportsByModuleTemplate: EndpointDefinition<unknown, ImportTemplateQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ImportTemplateQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const routeParams = await validateDto(AdminManageImportModuleParamDto, params, 'param');
    const typedQuery = query;
    const context = await assistedContext(schoolId, user.id);

    const file = await container()
      .importTemplates()
      .buildTemplate(routeParams.module, typedQuery.format);

    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.IMPORT_TEMPLATE_DOWNLOAD,
      entity_type: AUDIT_ENTITY_TYPES.IMPORT_JOB,
      entity_id: null,
      metadata: {
        module: routeParams.module,
        format: typedQuery.format,
        context: AUDIT_CONTEXT_ASSISTED_MANAGEMENT,
        assisted_session_id: context?.assisted_session_id ?? null,
      },
    });

    return bufferFileResponse(
      file.buffer,
      sanitizeFileName(file.fileName, `download.${file.format}`),
      file.format,
    );
  },};

/** `POST /api/v1/admin/schools/:schoolId/manage/imports/:module/validate` */
export const postAdminSchoolsBySchoolIdManageImportsByModuleValidate: EndpointDefinition<unknown, ImportUploadDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'data_import',
  status: HttpStatus.OK,
  queryType: ImportUploadDto,
  handler: async ({ user, query, params, raw }) => {
    const schoolId = parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const routeParams = await validateDto(AdminManageImportModuleParamDto, params, 'param');
    const typedQuery = query;
    const file = await parseUploadedSpreadsheet(raw, 'file', MAX_IMPORT_FILE_BYTES);
    const upload = requireSpreadsheet(file);

    return container()
      .imports()
      .validate(
        { schoolId, userId: user.id, context: await assistedContext(schoolId, user.id) },
        routeParams.module as ImportModule,
        typedQuery.mode ?? ImportMode.CREATE,
        upload,
      );
  },};

/** `POST /api/v1/admin/schools/:schoolId/manage/imports/:module/commit` */
export const postAdminSchoolsBySchoolIdManageImportsByModuleCommit: EndpointDefinition<unknown, ImportUploadDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'data_import',
  status: HttpStatus.OK,
  queryType: ImportUploadDto,
  handler: async ({ user, query, params, raw }) => {
    const schoolId = parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const routeParams = await validateDto(AdminManageImportModuleParamDto, params, 'param');
    const typedQuery = query;
    const file = await parseUploadedSpreadsheet(raw, 'file', MAX_IMPORT_FILE_BYTES);
    const upload = requireSpreadsheet(file);

    return container()
      .imports()
      .commit(
        { schoolId, userId: user.id, context: await assistedContext(schoolId, user.id) },
        routeParams.module as ImportModule,
        typedQuery.mode ?? ImportMode.CREATE,
        upload,
      );
  },};

/** `GET /api/v1/admin/schools/:schoolId/manage/reports/:report/export` */
export const getAdminSchoolsBySchoolIdManageReportsByReportExport: EndpointDefinition<unknown, ReportQueryDto> = {
  managedSchool: true,
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'report_read',
  status: HttpStatus.OK,
  queryType: ReportQueryDto,
  handler: async ({ user, query, params }) => {
    const schoolId = params[MANAGED_SCHOOL_PARAM];
    const userId = user.id;
    const routeParams = await validateDto(AdminManageReportParamDto, params, 'param');
    const typedQuery = query;

    const sessionId = await container().assistedSession().findOpenSessionId(schoolId, userId);
    const file = await container()
      .reports()
      .exportReport(schoolId, userId, routeParams.report, typedQuery, {
        assisted_session_id: sessionId,
      });

    const format = typedQuery.format ?? DataFileFormat.XLSX;
    return bufferFileResponse(
      file.buffer,
      sanitizeFileName(file.fileName, `report.${format}`),
      format,
    );
  },};

/* --- Session lifecycle ---------------------------------------------------
 * The only assisted endpoints that stay usable while the managed school is
 * deactivated (`allowWhenInactive`), so a platform operator can still open a
 * read-only session on a suspended tenant.
 * ---------------------------------------------------------------------- */

function toSchoolSummary(school: ManagedSchoolContext) {
  return { id: school.id, name: school.name, code: school.code, is_active: school.is_active };
}

function toSessionResponse(session: AssistedManagementSession) {
  return {
    id: session.id,
    school_id: session.school_id,
    actor_user_id: session.actor_user_id,
    started_at: session.started_at.toISOString(),
    ended_at: session.ended_at ? session.ended_at.toISOString() : null,
    end_reason: session.end_reason,
  };
}

/** Guard-populated context; unreachable as undefined behind the guard chain. */
function requireManaged(request: unknown): ManagedSchoolContext {
  const managed = (request as { managedSchool?: ManagedSchoolContext }).managedSchool;
  if (!managed) {
    throw new Error('Assisted-management request context is missing');
  }
  return managed;
}

/** `POST /api/v1/admin/schools/:schoolId/manage/session` — enter the school. */
export const postAdminSchoolsBySchoolIdManageSession: EndpointDefinition = {
  managedSchool: true,
  allowWhenInactive: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  handler: async ({ user, params, request }) => {
    parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const school = requireManaged(request);
    const session = await container()
      .assistedSession()
      .start(school, { userId: user.id }, { ip_address: request.ip ?? null });
    return {
      session: toSessionResponse(session),
      school: toSchoolSummary(school),
      capabilities: [...ASSISTED_MANAGEMENT_CAPABILITIES],
    };
  },
};

/** `GET /api/v1/admin/schools/:schoolId/manage/session/current` */
export const getAdminSchoolsBySchoolIdManageSessionCurrent: EndpointDefinition = {
  managedSchool: true,
  allowWhenInactive: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const school = requireManaged(request);
    const session = await container().assistedSession().findOpen(school.id, user.id);
    return {
      session: session ? toSessionResponse(session) : null,
      school: toSchoolSummary(school),
    };
  },
};

/** `POST /api/v1/admin/schools/:schoolId/manage/session/end` — idempotent exit. */
export const postAdminSchoolsBySchoolIdManageSessionEnd: EndpointDefinition = {
  managedSchool: true,
  allowWhenInactive: true,
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    parseUuidParam(params[MANAGED_SCHOOL_PARAM], '4');
    const school = requireManaged(request);
    const session = await container().assistedSession().end(school, { userId: user.id });
    return {
      session: session ? toSessionResponse(session) : null,
      school: toSchoolSummary(school),
    };
  },
};
