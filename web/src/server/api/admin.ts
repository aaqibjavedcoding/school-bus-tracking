/**
 * Endpoint definitions for the `admin` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 *
 * Every mutation below is audited: the platform SUPER_ADMIN is the actor
 * (`school_id` stays `null` for platform-wide plans, and is the managed
 * school for school/admin/subscription rows — the same convention the
 * assisted-management surface uses).
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { AdminDashboardResponse, AdminPlanCreateRequest, AdminPlanLifecycleResponse, AdminPlanListResponse, AdminPlanResponse, AdminPlanUpdateRequest, AdminSchoolAdminListResponse, AdminSchoolAdminResponse, AdminSchoolCreateRequest, AdminSchoolDetailsResponse, AdminSchoolLifecycleResponse, AdminSchoolListResponse, AdminSchoolResponse, AdminSchoolSubscriptionCancelRequest, AdminSchoolSubscriptionCreateRequest, AdminSchoolSubscriptionHistoryResponse, AdminSchoolSubscriptionResponse, AdminSchoolSubscriptionUpdateRequest, AdminSchoolUpdateRequest, AdminSubscriptionListResponse, UserRole } from '@school-bus-tracking/shared-types';
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from '../modules/audit/audit.constants';
import { auditRequestContext } from '../modules/audit/audit-request';
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
  handler: async ({ user, body, request }) => {
    const dto = body;
    const plan = await container().adminPlans().create(dto as AdminPlanCreateRequest);
    await container().audit().log({
      school_id: null,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.PLAN_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.PLAN,
      entity_id: plan.id,
      ...auditRequestContext({ request }),
    });
    return plan;
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
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['id']);
    const dto = body;
    const plan = await container().adminPlans().update(id, dto as AdminPlanUpdateRequest);
    await container().audit().log({
      school_id: null,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.PLAN_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.PLAN,
      entity_id: plan.id,
      ...auditRequestContext({ request }),
    });
    return plan;
  },};

/** `POST /api/v1/admin/plans/:id/activate` */
export const postAdminPlansByIdActivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id']);
    const result = await container().adminPlans().activate(id);
    await container().audit().log({
      school_id: null,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.PLAN_ACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.PLAN,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
  },
};

/** `POST /api/v1/admin/plans/:id/deactivate` */
export const postAdminPlansByIdDeactivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['id']);
    const result = await container().adminPlans().deactivate(id);
    await container().audit().log({
      school_id: null,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.PLAN_DEACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.PLAN,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
  },
};

/** `GET /api/v1/admin/schools/:schoolId/admins` */
export const getAdminSchoolsByIdAdmins: EndpointDefinition<unknown, ListSchoolAdminsQueryDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  queryType: ListSchoolAdminsQueryDto,
  handler: async ({ query, params }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    return container().adminSchoolAdmins().list(schoolId, query);
  },};

/** `POST /api/v1/admin/schools/:schoolId/admins` */
export const postAdminSchoolsByIdAdmins: EndpointDefinition<CreateSchoolAdminDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateSchoolAdminDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    const admin = await container().adminSchoolAdmins().create(schoolId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_ADMIN_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: admin.id,
      ...auditRequestContext({ request }),
    });
    return admin;
  },};

/** `PATCH /api/v1/admin/schools/:schoolId/admins/:adminId` */
export const patchAdminSchoolsByIdAdminsByAdminId: EndpointDefinition<UpdateSchoolAdminDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateSchoolAdminDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const adminId = parseUuidParam(params['adminId']);
    const dto = body;
    const admin = await container().adminSchoolAdmins().update(schoolId, adminId, dto);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_ADMIN_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: admin.id,
      ...auditRequestContext({ request }),
    });
    return admin;
  },};

/** `POST /api/v1/admin/schools/:schoolId/admins/:adminId/activate` */
export const postAdminSchoolsByIdAdminsByAdminIdActivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const adminId = parseUuidParam(params['adminId']);
    const admin = await container().adminSchoolAdmins().setActive(schoolId, adminId, true);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.USER_ACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: admin.id,
      ...auditRequestContext({ request }),
    });
    return admin;
  },
};

/** `POST /api/v1/admin/schools/:schoolId/admins/:adminId/deactivate` */
export const postAdminSchoolsByIdAdminsByAdminIdDeactivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const adminId = parseUuidParam(params['adminId']);
    const admin = await container().adminSchoolAdmins().setActive(schoolId, adminId, false);
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.USER_DEACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: admin.id,
      ...auditRequestContext({ request }),
    });
    return admin;
  },
};

/** `POST /api/v1/admin/schools/:schoolId/admins/:adminId/reset-password` */
export const postAdminSchoolsByIdAdminsByAdminIdResetpassword: EndpointDefinition<ResetSchoolAdminPasswordDto> = {
  roles: [UserRole.SUPER_ADMIN],
  rateLimit: 'password_reset',
  status: HttpStatus.OK,
  bodyType: ResetSchoolAdminPasswordDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const adminId = parseUuidParam(params['adminId']);
    const dto = body;
    const result = await container().adminSchoolAdmins().resetPassword(schoolId, adminId, dto);
    // The new password (or its hash) must never appear in the audit trail —
    // only the fact that this actor reset this account.
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_ADMIN_PASSWORD_RESET,
      entity_type: AUDIT_ENTITY_TYPES.USER,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
  },};

/** `POST /api/v1/admin/schools` */
export const postAdminSchools: EndpointDefinition<CreateAdminSchoolDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: CreateAdminSchoolDto,
  handler: async ({ user, body, request }) => {
    const dto = body;
    const details = await container().adminSchools().create(dto as AdminSchoolCreateRequest);
    await container().audit().log({
      school_id: details.school.id,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_CREATE,
      entity_type: AUDIT_ENTITY_TYPES.SCHOOL,
      entity_id: details.school.id,
      ...auditRequestContext({ request }),
    });
    return details;
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

/** `GET /api/v1/admin/schools/:schoolId` */
export const getAdminSchoolsById: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ params }) => {
    const id = parseUuidParam(params['schoolId']);
    return container().adminSchools().findOneOrThrow(id);
  },
};

/** `PATCH /api/v1/admin/schools/:schoolId` */
export const patchAdminSchoolsById: EndpointDefinition<UpdateAdminSchoolDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateAdminSchoolDto,
  handler: async ({ user, body, params, request }) => {
    const id = parseUuidParam(params['schoolId']);
    const dto = body;
    const school = await container().adminSchools().update(id, dto as AdminSchoolUpdateRequest);
    await container().audit().log({
      school_id: id,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_UPDATE,
      entity_type: AUDIT_ENTITY_TYPES.SCHOOL,
      entity_id: school.id,
      ...auditRequestContext({ request }),
    });
    return school;
  },};

/** `POST /api/v1/admin/schools/:schoolId/activate` */
export const postAdminSchoolsByIdActivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['schoolId']);
    const result = await container().adminSchools().activate(id);
    await container().audit().log({
      school_id: id,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_ACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.SCHOOL,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
  },
};

/** `POST /api/v1/admin/schools/:schoolId/deactivate` */
export const postAdminSchoolsByIdDeactivate: EndpointDefinition = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  handler: async ({ user, params, request }) => {
    const id = parseUuidParam(params['schoolId']);
    const result = await container().adminSchools().deactivate(id);
    await container().audit().log({
      school_id: id,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SCHOOL_DEACTIVATE,
      entity_type: AUDIT_ENTITY_TYPES.SCHOOL,
      entity_id: result.id,
      ...auditRequestContext({ request }),
    });
    return result;
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
  handler: async ({ user, body, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    const subscription = await container().adminSubscriptions().createSubscription(
    schoolId,
    dto as AdminSchoolSubscriptionCreateRequest,
    );
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SUBSCRIPTION_ASSIGN,
      entity_type: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      entity_id: subscription.id ?? null,
      ...auditRequestContext({ request }),
      metadata: { plan_id: subscription.plan_id },
    });
    return subscription;
  },};

/** `PATCH /api/v1/admin/schools/:schoolId/subscription` */
export const patchAdminSchoolsBySchoolIdSubscription: EndpointDefinition<UpdateSchoolSubscriptionDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: UpdateSchoolSubscriptionDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    const subscription = await container().adminSubscriptions().updateSubscription(
    schoolId,
    dto as AdminSchoolSubscriptionUpdateRequest,
    );
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CHANGE,
      entity_type: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      entity_id: subscription.id ?? null,
      ...auditRequestContext({ request }),
      metadata: { plan_id: subscription.plan_id },
    });
    return subscription;
  },};

/** `POST /api/v1/admin/schools/:schoolId/subscription/cancel` */
export const postAdminSchoolsBySchoolIdSubscriptionCancel: EndpointDefinition<CancelSchoolSubscriptionDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.OK,
  bodyType: CancelSchoolSubscriptionDto,
  handler: async ({ user, body, params, request }) => {
    const schoolId = parseUuidParam(params['schoolId']);
    const dto = body;
    const subscription = await container().adminSubscriptions().cancelSubscription(
    schoolId,
    dto as AdminSchoolSubscriptionCancelRequest,
    );
    await container().audit().log({
      school_id: schoolId,
      actor_user_id: user.id,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CANCEL,
      entity_type: AUDIT_ENTITY_TYPES.SUBSCRIPTION,
      entity_id: subscription.id ?? null,
      ...auditRequestContext({ request }),
      metadata: { plan_id: subscription.plan_id },
    });
    return subscription;
  },};
