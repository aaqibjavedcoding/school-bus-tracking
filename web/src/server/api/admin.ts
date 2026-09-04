/**
 * Endpoint definitions for the `admin` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { AdminDashboardResponse, AdminPlanCreateRequest, AdminPlanLifecycleResponse, AdminPlanListResponse, AdminPlanResponse, AdminPlanUpdateRequest, AdminSchoolAdminListResponse, AdminSchoolAdminResponse, AdminSchoolCreateRequest, AdminSchoolDetailsResponse, AdminSchoolLifecycleResponse, AdminSchoolListResponse, AdminSchoolResponse, AdminSchoolSubscriptionCancelRequest, AdminSchoolSubscriptionCreateRequest, AdminSchoolSubscriptionHistoryResponse, AdminSchoolSubscriptionResponse, AdminSchoolSubscriptionUpdateRequest, AdminSchoolUpdateRequest, AdminSubscriptionListResponse, UserRole } from '@school-bus-tracking/shared-types';
import { AdminDashboardService } from '../modules/admin/admin-dashboard.service';
import { AdminGlobalSubscriptionsService } from '../modules/admin/admin-global-subscriptions.service';
import { CancelSchoolSubscriptionDto, CreateAdminPlanDto, CreateAdminSchoolDto, CreateSchoolAdminDto, CreateSchoolSubscriptionDto, ListAdminPlansQueryDto, ListAdminSchoolsQueryDto, ListAdminSubscriptionsQueryDto, ListSchoolAdminsQueryDto, ResetSchoolAdminPasswordDto, UpdateAdminPlanDto, UpdateAdminSchoolDto, UpdateSchoolAdminDto, UpdateSchoolSubscriptionDto } from '../modules/admin/dto';
import { AdminPlansService } from '../modules/admin/admin-plans.service';
import { AdminSchoolAdminsService } from '../modules/admin/admin-school-admins.service';
import { AdminSchoolsService } from '../modules/admin/admin-schools.service';
import { AdminSubscriptionsService } from '../modules/admin/admin-subscriptions.service';

/** `GET /api/v1/admin/dashboard` */
export const getAdminDashboard: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async () => {
    return container().adminDashboard().getMetrics();
  },
};

/** `GET /api/v1/admin/subscriptions` */
export const getAdminSubscriptions: EndpointDefinition<unknown, ListAdminSubscriptionsQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListAdminSubscriptionsQueryDto,
  handler: async ({ query }) => {
    return container().adminGlobalSubscriptions().findAll(query);
  },};

/** `POST /api/v1/admin/plans` */
export const postAdminPlans: EndpointDefinition<CreateAdminPlanDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateAdminPlanDto,
  handler: async ({ body }) => {
    const dto = body;
    return container().adminPlans().create(dto as AdminPlanCreateRequest);
  },};

/** `GET /api/v1/admin/plans` */
export const getAdminPlans: EndpointDefinition<unknown, ListAdminPlansQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListAdminPlansQueryDto,
  handler: async ({ query }) => {
    return container().adminPlans().findAll(query);
  },};

/** `GET /api/v1/admin/plans/:id` */
export const getAdminPlansById: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id']);
    return container().adminPlans().findOneOrThrow(id);
  },
};

/** `PATCH /api/v1/admin/plans/:id` */
export const patchAdminPlansById: EndpointDefinition<UpdateAdminPlanDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateAdminPlanDto,
  handler: async ({ body, params }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().adminPlans().update(id, dto as AdminPlanUpdateRequest);
  },};

/** `POST /api/v1/admin/plans/:id/activate` */
export const postAdminPlansByIdActivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id']);
    return container().adminPlans().activate(id);
  },
};

/** `POST /api/v1/admin/plans/:id/deactivate` */
export const postAdminPlansByIdDeactivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id']);
    return container().adminPlans().deactivate(id);
  },
};

/** `GET /api/v1/admin/schools/:id/admins` */
export const getAdminSchoolsByIdAdmins: EndpointDefinition<unknown, ListSchoolAdminsQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListSchoolAdminsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['id']);
    return container().adminSchoolAdmins().list(schoolId, query);
  },};

/** `POST /api/v1/admin/schools/:id/admins` */
export const postAdminSchoolsByIdAdmins: EndpointDefinition<CreateSchoolAdminDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateSchoolAdminDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['id']);
    const dto = body;
    return container().adminSchoolAdmins().create(schoolId, dto);
  },};

/** `PATCH /api/v1/admin/schools/:id/admins/:adminId` */
export const patchAdminSchoolsByIdAdminsByAdminId: EndpointDefinition<UpdateSchoolAdminDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateSchoolAdminDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['id']);
    const adminId = parseUuidParam(params['adminId']);
    const dto = body;
    return container().adminSchoolAdmins().update(schoolId, adminId, dto);
  },};

/** `POST /api/v1/admin/schools/:id/admins/:adminId/activate` */
export const postAdminSchoolsByIdAdminsByAdminIdActivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['id']);
    const adminId = parseUuidParam(params['adminId']);
    return container().adminSchoolAdmins().setActive(schoolId, adminId, true);
  },
};

/** `POST /api/v1/admin/schools/:id/admins/:adminId/deactivate` */
export const postAdminSchoolsByIdAdminsByAdminIdDeactivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['id']);
    const adminId = parseUuidParam(params['adminId']);
    return container().adminSchoolAdmins().setActive(schoolId, adminId, false);
  },
};

/** `POST /api/v1/admin/schools/:id/admins/:adminId/reset-password` */
export const postAdminSchoolsByIdAdminsByAdminIdResetpassword: EndpointDefinition<ResetSchoolAdminPasswordDto> = {
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'password_reset',
  status: HttpStatus.OK,
  bodyType: ResetSchoolAdminPasswordDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['id']);
    const adminId = parseUuidParam(params['adminId']);
    const dto = body;
    return container().adminSchoolAdmins().resetPassword(schoolId, adminId, dto);
  },};

/** `POST /api/v1/admin/schools` */
export const postAdminSchools: EndpointDefinition<CreateAdminSchoolDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateAdminSchoolDto,
  handler: async ({ body }) => {
    const dto = body;
    return container().adminSchools().create(dto as AdminSchoolCreateRequest);
  },};

/** `GET /api/v1/admin/schools` */
export const getAdminSchools: EndpointDefinition<unknown, ListAdminSchoolsQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'read_heavy',
  status: HttpStatus.OK,
  queryType: ListAdminSchoolsQueryDto,
  handler: async ({ query }) => {
    return container().adminSchools().findAll(query);
  },};

/** `GET /api/v1/admin/schools/:id` */
export const getAdminSchoolsById: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id']);
    return container().adminSchools().findOneOrThrow(id);
  },
};

/** `PATCH /api/v1/admin/schools/:id` */
export const patchAdminSchoolsById: EndpointDefinition<UpdateAdminSchoolDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateAdminSchoolDto,
  handler: async ({ body, params }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    return container().adminSchools().update(id, dto as AdminSchoolUpdateRequest);
  },};

/** `POST /api/v1/admin/schools/:id/activate` */
export const postAdminSchoolsByIdActivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id']);
    return container().adminSchools().activate(id);
  },
};

/** `POST /api/v1/admin/schools/:id/deactivate` */
export const postAdminSchoolsByIdDeactivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['id']);
    return container().adminSchools().deactivate(id);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/subscription` */
export const getAdminSchoolsBySchoolIdSubscription: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().adminSubscriptions().getSubscription(schoolId);
  },
};

/** `GET /api/v1/admin/schools/:schoolId/subscription/history` */
export const getAdminSchoolsBySchoolIdSubscriptionHistory: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().adminSubscriptions().getSubscriptionHistory(schoolId);
  },
};

/** `POST /api/v1/admin/schools/:schoolId/subscription` */
export const postAdminSchoolsBySchoolIdSubscription: EndpointDefinition<CreateSchoolSubscriptionDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateSchoolSubscriptionDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().adminSubscriptions().createSubscription(
    schoolId,
    dto as AdminSchoolSubscriptionCreateRequest,
    );
  },};

/** `PATCH /api/v1/admin/schools/:schoolId/subscription` */
export const patchAdminSchoolsBySchoolIdSubscription: EndpointDefinition<UpdateSchoolSubscriptionDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateSchoolSubscriptionDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().adminSubscriptions().updateSubscription(
    schoolId,
    dto as AdminSchoolSubscriptionUpdateRequest,
    );
  },};

/** `POST /api/v1/admin/schools/:schoolId/subscription/cancel` */
export const postAdminSchoolsBySchoolIdSubscriptionCancel: EndpointDefinition<CancelSchoolSubscriptionDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: CancelSchoolSubscriptionDto,
  handler: async ({ body, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    return container().adminSubscriptions().cancelSubscription(
    schoolId,
    dto as AdminSchoolSubscriptionCancelRequest,
    );
  },};
