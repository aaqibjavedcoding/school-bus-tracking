/**
 * Shared Types for School Bus Tracking SaaS (Phase 1)
 */

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  service: string;
  version: string;
  uptime: number;
  timestamp: string;
  environment: string;
}

export interface Coordinates {
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  altitude?: number;
  accuracy?: number;
  timestamp: number;
}

export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  SCHOOL_ADMIN = 'SCHOOL_ADMIN',
  DRIVER = 'DRIVER',
  CONDUCTOR = 'CONDUCTOR',
  PARENT = 'PARENT',
}

/** Operational role stored by a RouteAssignment row. */
export enum RouteAssignmentRole {
  DRIVER = 'DRIVER',
  CONDUCTOR = 'CONDUCTOR',
}

/** Short alias for consumers that call the resource simply `assignments`. */
export type AssignmentRole = RouteAssignmentRole;

/**
 * Lifecycle of a single scheduled bus run (`trips.status`).
 *
 * SCHEDULED   → planned, nothing has happened yet
 * BOARDING    → crew is at the first stop and students are getting on
 * IN_PROGRESS → the bus departed and is driving the route
 * COMPLETED   → the final stop was reached and the run is closed
 * CANCELLED   → the run will not happen (weather, vehicle fault, holiday, …)
 *
 * `COMPLETED` and `CANCELLED` are terminal. The database only guarantees the
 * value set; the transition rules are enforced by the API service layer.
 */
export enum TripStatus {
  SCHEDULED = 'SCHEDULED',
  BOARDING = 'BOARDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

export enum StudentGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export enum VehicleStatus {
  INACTIVE = 'INACTIVE',
  EN_ROUTE = 'EN_ROUTE',
  AT_STOP = 'AT_STOP',
  DELAYED = 'DELAYED',
  EMERGENCY = 'EMERGENCY',
  MAINTENANCE = 'MAINTENANCE',
}

export enum StudentBoardingStatus {
  PENDING = 'PENDING',
  BOARDED = 'BOARDED',
  DEBOARDED = 'DEBOARDED',
  ABSENT = 'ABSENT',
}

/**
 * Attendance state of one student on one concrete trip
 * (`trip_student_attendance.status`).
 *
 * PENDING → the student is on the trip manifest but has not boarded yet. It
 *           is the implicit state of every manifest entry without a stored
 *           attendance row, so the crew app never has to special-case `null`.
 * BOARDED → the crew scanned/confirmed the student onto the bus.
 * DROPPED → the student left the bus at their stop.
 *
 * The only legal progression is PENDING → BOARDED → DROPPED; the API rejects
 * boarding twice, dropping before boarding and dropping twice.
 */
export enum TripAttendanceStatus {
  PENDING = 'PENDING',
  BOARDED = 'BOARDED',
  DROPPED = 'DROPPED',
}

/**
 * Body of `POST /api/v1/auth/login`.
 *
 * Normal school users (SCHOOL_ADMIN, DRIVER, CONDUCTOR, PARENT) log in
 * tenant-scoped: the same email may exist under multiple schools, so their
 * `school_id` is required. `school_id` identifies the tenant and may be either
 * the school's opaque UUID or its human-friendly tenant `code` (e.g.
 * `lincoln-high`) — the API resolves a code to the matching tenant. A platform
 * `SUPER_ADMIN` belongs to no tenant and logs in with `school_id` omitted (or
 * `null`) — the API resolves the platform account by email.
 */
export interface LoginRequest {
  school_id?: string | null;
  email: string;
  password: string;
}

/**
 * Claims carried by an access token issued by the API.
 *
 * `sub` is the user id and `role` the platform role. `school_id` scopes every
 * claim to a tenant for school users; it is `null` for the platform
 * `SUPER_ADMIN`, which is explicitly not a member of any school tenant.
 */
export interface JwtAccessTokenPayload {
  sub: string;
  school_id: string | null;
  role: UserRole;
}

/**
 * Public projection of an authenticated user. Never contains credentials
 * (`password` / `password_hash` must not appear in any API response).
 *
 * `school_id` is the tenant anchor for school users and `null` for a
 * platform `SUPER_ADMIN`.
 */
export interface AuthenticatedUser {
  id: string;
  school_id: string | null;
  role: UserRole;
  first_name: string;
  last_name: string;
  email: string | null;
}

/** Successful response payload of `POST /api/v1/auth/login`. */
export interface LoginResponse {
  access_token: string;
  token_type: 'Bearer';
  /** Access token lifetime in seconds. */
  expires_in: number;
  user: AuthenticatedUser;
}

/** Successful response payload of `POST /api/v1/auth/refresh`. */
export interface RefreshResponse {
  access_token: string;
  token_type: 'Bearer';
  /** Access token lifetime in seconds. */
  expires_in: number;
  user: AuthenticatedUser;
}

/** Successful response payload of `POST /api/v1/auth/logout`. */
export interface LogoutResponse {
  message: string;
}

/**
 * Body of `POST /api/v1/schools` — the school onboarding flow.
 *
 * A platform operator (`SUPER_ADMIN`) provisions a new tenant and its first
 * `SCHOOL_ADMIN` account in one atomic operation. The `admin.name` is a full
 * display name which the API splits into `first_name` / `last_name` for the
 * `users` table.
 */
export interface SchoolOnboardingRequest {
  school: {
    name: string;
    code: string;
  };
  admin: {
    name: string;
    email: string;
    password: string;
  };
}

/** Public projection of a school created through onboarding. */
export interface OnboardedSchool {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Public projection of the initial school admin created through onboarding. */
export interface OnboardedAdmin {
  id: string;
  school_id: string;
  role: UserRole.SCHOOL_ADMIN;
  first_name: string;
  last_name: string;
  email: string;
}

/** Successful response payload of `POST /api/v1/schools`. */
export interface SchoolOnboardingResponse {
  school: OnboardedSchool;
  admin: OnboardedAdmin;
}

/**
 * Super Admin platform console (Task 19).
 *
 * Everything below is served under `/api/v1/admin/*` and is reachable only by
 * an authenticated `SUPER_ADMIN` (JwtAuthGuard + RolesGuard on every route).
 * A platform admin is not a member of any school tenant: these endpoints take
 * the managed school id from the route (or the request body for creation),
 * never from a trusted client claim.
 *
 * The domain layer is deliberately shaped so the next SaaS phase can add
 * Plans / Subscriptions / Billing without reshaping these contracts: school
 * rows already carry a `subscription` placeholder and every response is a
 * plain, additive projection.
 */

/** Lifecycle state of a tenant school as seen by the platform console. */
export type AdminSchoolStatus = 'active' | 'inactive';

/** Contact/profile block of a school accepted by the platform create flow. */
export interface AdminSchoolProfileRequest {
  name: string;
  code: string;
  subdomain?: string | null;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string;
}

/**
 * Initial SCHOOL_ADMIN account provisioned with a new school. The password is
 * accepted on the way in, bcrypt-hashed server-side and is never returned.
 */
export interface AdminSchoolInitialAdminRequest {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone?: string | null;
}

/** Body of `POST /api/v1/admin/schools`. */
export interface AdminSchoolCreateRequest {
  school: AdminSchoolProfileRequest;
  admin: AdminSchoolInitialAdminRequest;
}

/**
 * Body of `PATCH /api/v1/admin/schools/:id` — profile fields only.
 *
 * Identity/ownership fields are deliberately absent and rejected: the school
 * `id`, `code`, `subdomain` ownership may not be mutated through this
 * endpoint, and there is no `is_active` field — lifecycle changes go through
 * the explicit activate/deactivate endpoints.
 */
export interface AdminSchoolUpdateRequest {
  name?: string;
  email?: string | null;
  phone?: string | null;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  timezone?: string;
}

/**
 * Subscription placeholder. No billing is implemented in this phase; the
 * object always reports `status: 'none'` so the web console can render a
 * ready-for-billing section and the next phase can fill in plan/period
 * details without a contract change.
 */
export interface AdminSchoolSubscriptionInfo {
  status: 'none';
  plan: null;
  current_period_end: null;
}

/** Platform-level school profile projection (no credentials, ever). */
export interface AdminSchoolResponse {
  id: string;
  name: string;
  code: string;
  subdomain: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
  timezone: string;
  status: AdminSchoolStatus;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** One row of the platform school list with aggregate tenant statistics. */
export interface AdminSchoolSummary extends AdminSchoolResponse {
  /** Primary school admin (first created), used as the table's contact. */
  primary_admin: {
    id: string;
    first_name: string;
    last_name: string;
    email: string | null;
  } | null;
  stats: {
    admin_count: number;
    student_count: number;
    /** Active drivers + conductors. */
    active_staff_count: number;
    bus_count: number;
  };
  /** Subscription placeholder — always present, ready for the billing phase. */
  subscription: AdminSchoolSubscriptionInfo;
}

/** Query string of `GET /api/v1/admin/schools`. */
export interface AdminSchoolListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminSchoolStatus;
  sort?: 'created_at' | 'name' | 'code';
  order?: 'asc' | 'desc';
}

/** Successful payload of `GET /api/v1/admin/schools`. */
export interface AdminSchoolListResponse {
  items: AdminSchoolSummary[];
  meta: PaginationMeta;
}

/** Public projection of a SCHOOL_ADMIN account managed by the platform. */
export interface AdminSchoolAdminResponse {
  id: string;
  school_id: string;
  role: UserRole.SCHOOL_ADMIN;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  email_verified_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/admin/schools/:id/admins`. */
export interface AdminSchoolAdminListResponse {
  items: AdminSchoolAdminResponse[];
  meta: PaginationMeta;
}

/** Body of `POST /api/v1/admin/schools/:id/admins`. */
export interface AdminSchoolAdminCreateRequest {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/admin/schools/:id/admins/:adminId`. */
export interface AdminSchoolAdminUpdateRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Body of `POST .../admins/:adminId/reset-password`. */
export interface AdminSchoolAdminResetPasswordRequest {
  password: string;
}

/** Tenant statistics block of `GET /api/v1/admin/schools/:id`. */
export interface AdminSchoolStats {
  admin_count: number;
  active_admin_count: number;
  student_count: number;
  active_student_count: number;
  driver_count: number;
  conductor_count: number;
  active_staff_count: number;
  parent_count: number;
  bus_count: number;
  active_bus_count: number;
  route_count: number;
  active_route_count: number;
  trip_count: number;
  active_trip_count: number;
}

/** Successful payload of `GET /api/v1/admin/schools/:id`. */
export interface AdminSchoolDetailsResponse {
  school: AdminSchoolResponse;
  stats: AdminSchoolStats;
  admins: AdminSchoolAdminResponse[];
  subscription: AdminSchoolSubscriptionInfo;
}

/** Body/response of the activate/deactivate lifecycle endpoints. */
export interface AdminSchoolLifecycleResponse {
  id: string;
  status: AdminSchoolStatus;
  is_active: boolean;
  message: string;
}

/** Successful payload of `GET /api/v1/admin/dashboard`. */
export interface AdminDashboardResponse {
  schools: {
    total: number;
    active: number;
    inactive: number;
  };
  users: {
    total: number;
    school_admins: number;
    students: number;
    parents: number;
    drivers: number;
    conductors: number;
    super_admins: number;
  };
  transport: {
    buses: number;
    active_buses: number;
    routes: number;
    active_routes: number;
    trips: number;
    active_trips: number;
  };
  generated_at: string;
}

/** Body of `POST /api/v1/students`. */
export interface StudentCreateRequest {
  admission_number: string;
  first_name: string;
  last_name: string;
  date_of_birth?: string | null;
  gender?: StudentGender | null;
  grade_level?: string | null;
  home_stop_id?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  medical_notes?: string | null;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/students/:id` — every field is optional. */
export interface StudentUpdateRequest {
  admission_number?: string;
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  gender?: StudentGender | null;
  grade_level?: string | null;
  home_stop_id?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  medical_notes?: string | null;
  is_active?: boolean;
}

/**
 * Public projection of a student. `school_id` is included because it is the
 * tenant anchor used by every client-side scoping decision, but it never comes
 * from the client — the API always derives it from the authenticated user.
 */
export interface StudentResponse {
  id: string;
  school_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  /** ISO 8601 date (`YYYY-MM-DD`). */
  date_of_birth: string | null;
  gender: StudentGender | null;
  grade_level: string | null;
  home_stop_id: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  medical_notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/** Successful payload of `GET /api/v1/students`. */
export interface StudentListResponse {
  items: StudentResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/students/:id`. */
export interface StudentDeleteResponse {
  id: string;
  message: string;
}

/** Body of `POST /api/v1/parents` — a school-managed parent account. */
export interface ParentCreateRequest {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/parents/:id` — every field is optional. */
export interface ParentUpdateRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Public projection of a parent account. Credential columns are never exposed. */
export interface ParentResponse {
  id: string;
  school_id: string;
  role: UserRole.PARENT;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/parents`. */
export interface ParentListResponse {
  items: ParentResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/parents/:id`. */
export interface ParentDeleteResponse {
  id: string;
  message: string;
}

/** Body of `POST /api/v1/parents/:parentId/students`. */
export interface ParentStudentRelationshipCreateRequest {
  student_id: string;
  relationship: string;
  can_pick_up?: boolean;
  is_primary?: boolean;
}

/** Body of relationship updates. */
export interface ParentStudentRelationshipUpdateRequest {
  relationship?: string;
  can_pick_up?: boolean;
  is_primary?: boolean;
  is_active?: boolean;
}

/** Body of the student-centred guardian relationship endpoint. */
export interface StudentGuardianCreateRequest {
  parent_id: string;
  relationship: string;
  can_pick_up?: boolean;
  is_primary?: boolean;
}

export type StudentGuardianUpdateRequest = ParentStudentRelationshipUpdateRequest;

/**
 * Public projection of a tenant-scoped student ↔ parent relationship.
 *
 * The database stores the account foreign key as `user_id`; `parent_id` is
 * included as the resource-oriented alias used by parent management routes.
 * Both values identify the same PARENT user and neither is accepted as a
 * tenant identifier.
 */
export interface StudentGuardianResponse {
  id: string;
  school_id: string;
  student_id: string;
  user_id: string;
  parent_id: string;
  relationship: string;
  can_pick_up: boolean;
  is_primary: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of a parent relationship list endpoint. */
export interface StudentGuardianListResponse {
  items: StudentGuardianResponse[];
}

/** Successful payload of a relationship delete endpoint. */
export interface StudentGuardianDeleteResponse {
  id: string;
  message: string;
}

/**
 * Query string of `GET /api/v1/parents`.
 *
 * The API applies the tenant scope from the verified JWT rather than from a
 * query/header value supplied by a client.
 */
export interface ParentListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * Phase 3 — Driver & conductor staff management.
 *
 * Staff accounts reuse the existing `User` model with the fixed roles
 * `DRIVER` and `CONDUCTOR`. The school admin manages them through the
 * `/drivers` and `/conductors` resources. The staff role and `school_id` are
 * server-owned: the API derives the tenant exclusively from the verified JWT
 * claims and pins the role per resource, so a client can never create or
 * escalate an account.
 */

/** The two staff roles managed through the driver/conductor resources. */
export type StaffRole = UserRole.DRIVER | UserRole.CONDUCTOR;

/**
 * Body of `POST /api/v1/drivers` and `POST /api/v1/conductors`.
 *
 * Deliberately has no `school_id` or `role`: a client-supplied tenant or role
 * is rejected instead of silently stripped.
 */
export interface StaffCreateRequest {
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Body of driver/conductor `PATCH .../:id` — every field is optional. */
export interface StaffUpdateRequest {
  first_name?: string;
  last_name?: string;
  email?: string;
  password?: string;
  phone?: string | null;
  is_active?: boolean;
}

/** Public projection of a driver or conductor account. */
export interface StaffResponse<R extends StaffRole = StaffRole> {
  id: string;
  school_id: string;
  role: R;
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Public projection of a driver account. Credential columns are never exposed. */
export type DriverResponse = StaffResponse<UserRole.DRIVER>;

/** Public projection of a conductor account. Credential columns are never exposed. */
export type ConductorResponse = StaffResponse<UserRole.CONDUCTOR>;

/** Resource-oriented aliases of the staff request bodies. */
export type DriverCreateRequest = StaffCreateRequest;
export type ConductorCreateRequest = StaffCreateRequest;
export type DriverUpdateRequest = StaffUpdateRequest;
export type ConductorUpdateRequest = StaffUpdateRequest;

/** Generic paginated staff payload; the concrete resource fixes the item type. */
export interface StaffListResponse<T = StaffResponse> {
  items: T[];
  meta: PaginationMeta;
}

/** Successful payload of `GET /api/v1/drivers`. */
export type DriverListResponse = StaffListResponse<DriverResponse>;

/** Successful payload of `GET /api/v1/conductors`. */
export type ConductorListResponse = StaffListResponse<ConductorResponse>;

/** Successful payload of a driver/conductor `DELETE .../:id`. */
export interface StaffDeleteResponse {
  id: string;
  message: string;
}

/** Successful payload of `DELETE /api/v1/drivers/:id`. */
export type DriverDeleteResponse = StaffDeleteResponse;

/** Successful payload of `DELETE /api/v1/conductors/:id`. */
export type ConductorDeleteResponse = StaffDeleteResponse;

/**
 * Query string of `GET /api/v1/drivers` and `GET /api/v1/conductors`.
 *
 * The API applies the tenant scope from the verified JWT rather than from a
 * query/header value supplied by a client.
 */
export interface StaffListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export type DriverListQuery = StaffListQuery;
export type ConductorListQuery = StaffListQuery;

/**
 * Phase 4 — Bus, route and crew assignment management.
 *
 * `RouteAssignment` stores one row per crew member and role. A complete route
 * roster normally has one DRIVER row and one CONDUCTOR row sharing a bus,
 * route and effective period. `school_id` is never accepted in a request; the
 * API derives it from the verified JWT claims.
 */

/** Body of `POST /api/v1/route-assignments`. */
export interface RouteAssignmentCreateRequest {
  route_id: string;
  bus_id: string;
  user_id: string;
  role: RouteAssignmentRole;
  /** Inclusive tenant-local date in `YYYY-MM-DD` format. */
  effective_from: string;
  /** Inclusive end date; omitted/null means open ended. */
  effective_to?: string | null;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/route-assignments/:id` — every field is optional. */
export interface RouteAssignmentUpdateRequest {
  route_id?: string;
  /** `null` removes the vehicle from an inactive historical row. */
  bus_id?: string | null;
  user_id?: string;
  role?: RouteAssignmentRole;
  effective_from?: string;
  effective_to?: string | null;
  is_active?: boolean;
}

/** Public projection of a tenant-scoped driver/conductor roster row. */
export interface RouteAssignmentResponse {
  id: string;
  school_id: string;
  route_id: string;
  bus_id: string | null;
  user_id: string;
  role: RouteAssignmentRole;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/route-assignments`. */
export interface RouteAssignmentListResponse {
  items: RouteAssignmentResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/route-assignments/:id`. */
export interface RouteAssignmentDeleteResponse {
  id: string;
  message: string;
}

/** Query string of `GET /api/v1/route-assignments`. */
export interface RouteAssignmentListQuery {
  page?: number;
  limit?: number;
  route_id?: string;
  bus_id?: string;
  user_id?: string;
  role?: RouteAssignmentRole;
  is_active?: boolean;
}

/** Short resource aliases for clients that call the feature `assignments`. */
export type AssignmentCreateRequest = RouteAssignmentCreateRequest;
export type AssignmentUpdateRequest = RouteAssignmentUpdateRequest;
export type AssignmentResponse = RouteAssignmentResponse;
export type AssignmentListResponse = RouteAssignmentListResponse;
export type AssignmentDeleteResponse = RouteAssignmentDeleteResponse;
export type AssignmentListQuery = RouteAssignmentListQuery;

/**
 * Phase 4 — Trip management.
 *
 * A trip is one concrete execution of a route. It is always created from an
 * existing **active** `RouteAssignment`: the API derives the school, route,
 * bus, driver and conductor from that roster row, so a client can never mix
 * resources from another tenant or pair a bus with the wrong crew.
 * `school_id` is never accepted in a request body.
 */

/** Body of `POST /api/v1/trips`. */
export interface TripCreateRequest {
  /** Active roster row the trip is dispatched from. */
  route_assignment_id: string;
  /** Planned departure as an ISO-8601 date-time string (stored in UTC). */
  scheduled_start_at: string;
  /** Planned completion; omitted/null means open ended. */
  scheduled_end_at?: string | null;
}

/**
 * Body of `PATCH /api/v1/trips/:id` — rescheduling and re-dispatch.
 *
 * Only trips that are still `SCHEDULED` can be updated. `status` is not part
 * of this payload: lifecycle changes go through
 * `PATCH /api/v1/trips/:id/status` so the transition rules stay explicit.
 */
export interface TripUpdateRequest {
  route_assignment_id?: string;
  scheduled_start_at?: string;
  scheduled_end_at?: string | null;
}

/** Body of `PATCH /api/v1/trips/:id/status` — a single lifecycle transition. */
export interface TripStatusUpdateRequest {
  status: TripStatus;
  /** Overrides the server clock when moving into `IN_PROGRESS`. */
  actual_start_at?: string | null;
  /** Overrides the server clock when moving into `COMPLETED`. */
  actual_end_at?: string | null;
  /** Required-free audit note recorded when moving into `CANCELLED`. */
  cancellation_reason?: string | null;
}

/** Body of `POST /api/v1/trips/:id/cancel`. */
export interface TripCancelRequest {
  cancellation_reason?: string | null;
}

/** Public projection of a trip owned by the authenticated school. */
export interface TripResponse {
  id: string;
  school_id: string;
  route_id: string;
  bus_id: string | null;
  driver_id: string | null;
  conductor_id: string | null;
  status: TripStatus;
  scheduled_start_at: string;
  scheduled_end_at: string | null;
  actual_start_at: string | null;
  actual_end_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/trips`. */
export interface TripListResponse {
  items: TripResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/trips/:id`. */
export interface TripDeleteResponse {
  id: string;
  message: string;
}

/**
 * Query string of `GET /api/v1/trips`.
 *
 * `date` selects a single UTC calendar day, while `date_from`/`date_to` select
 * an inclusive range of UTC calendar days. All of them filter on
 * `scheduled_start_at`.
 */
export interface TripListQuery {
  page?: number;
  limit?: number;
  status?: TripStatus;
  route_id?: string;
  bus_id?: string;
  driver_id?: string;
  conductor_id?: string;
  /** Single day in `YYYY-MM-DD` format. */
  date?: string;
  /** Inclusive range start in `YYYY-MM-DD` format. */
  date_from?: string;
  /** Inclusive range end in `YYYY-MM-DD` format. */
  date_to?: string;
}

/**
 * Phase 4 — Trip student attendance (boarding / drop management).
 *
 * The manifest of a trip is *derived*, never stored: it is every active
 * student whose home stop belongs to the trip's route, ordered by the stop
 * sequence. Only the attendance events (boarded / dropped) are persisted, and
 * their timestamps are always taken from the server clock.
 *
 * Requests carry no tenant id, no route id, no stop id and no crew id: the
 * API resolves the trip from the verified JWT tenant and derives everything
 * else from it.
 */

/** One manifest row: the student plus their attendance state on this trip. */
export interface TripStudentAttendanceResponse {
  /** Attendance row id; `null` while the student is still `PENDING`. */
  id: string | null;
  school_id: string;
  trip_id: string;
  student_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  grade_level: string | null;
  /** Route stop the student is expected to board at. */
  stop_id: string;
  stop_name: string;
  stop_sequence_number: number;
  status: TripAttendanceStatus;
  /** Server-generated timestamps; never accepted from a client. */
  boarded_at: string | null;
  /** Crew/admin user id that recorded the boarding. */
  boarded_by: string | null;
  dropped_at: string | null;
  dropped_by: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Aggregated counts for the manifest scope the caller is allowed to see. */
export interface TripStudentManifestSummary {
  total: number;
  pending: number;
  boarded: number;
  dropped: number;
}

/** Successful payload of `GET /api/v1/trips/:tripId/students`. */
export interface TripStudentManifestResponse {
  trip_id: string;
  school_id: string;
  route_id: string;
  trip_status: TripStatus;
  /**
   * Manifest entries ordered by route stop sequence, then by student name —
   * consecutive entries with the same `stop_id` form the stop's group.
   */
  items: TripStudentAttendanceResponse[];
  /** Counts over the whole visible manifest, before any `status` filter. */
  summary: TripStudentManifestSummary;
}

/** Query string of `GET /api/v1/trips/:tripId/students`. */
export interface TripStudentManifestQuery {
  /** Only entries currently in this attendance state. */
  status?: TripAttendanceStatus;
  /** Only entries boarding at this route stop. */
  stop_id?: string;
}

/**
 * Bodies of `POST /api/v1/trips/:tripId/students/:studentId/board` and
 * `.../drop`.
 *
 * Deliberately empty: who performed the action comes from the JWT subject and
 * when it happened comes from the server clock, so there is nothing safe for
 * a client to contribute.
 */
export type TripStudentBoardRequest = Record<string, never>;
export type TripStudentDropRequest = Record<string, never>;

/**
 * Phase 5 — Live GPS tracking (real-time bus location).
 *
 * Coordinates originate exclusively from the driver's or conductor's mobile
 * device. The API persists every accepted fix, stamps it with the *server*
 * receipt time (`received_at` — a client can never fake it) and re-broadcasts
 * it to the Socket.IO room of the trip. Observers never supply a tenant id, a
 * crew id or a timestamp the API has not verified: the tenant and the crew
 * identity come from the JWT, the bus and the route come from the trip.
 *
 * No map provider is required by the backend: `latitude` / `longitude` are
 * plain WGS-84 numbers that a future Leaflet/OpenStreetMap layer (or any
 * other renderer) can consume as-is.
 */

/** A single GPS fix as reported by the crew device. */
export interface GpsLocationFix {
  /** WGS-84 latitude, -90..90. */
  latitude: number;
  /** WGS-84 longitude, -180..180. */
  longitude: number;
  /** Horizontal accuracy in metres (device-reported, optional). */
  accuracy?: number;
  /** Ground speed in km/h (device-reported, optional). */
  speed?: number;
  /** Compass heading in degrees, 0..360 (device-reported, optional). */
  heading?: number;
  /** ISO-8601 time the fix was taken on the device. */
  recorded_at: string;
}

/**
 * State of the live tracking stream for a trip, derived from its lifecycle:
 *
 * `unavailable` → `SCHEDULED` (nothing can be broadcast yet)
 * `active`      → `BOARDING` / `IN_PROGRESS` (updates are accepted)
 * `stopped`     → `COMPLETED` / `CANCELLED` (no further updates are ever
 *                  accepted; the last recorded location stays readable)
 */
export type TripTrackingState = 'unavailable' | 'active' | 'stopped';

/** One persisted GPS fix of a trip. */
export interface TripLocationResponse {
  id: string;
  school_id: string;
  trip_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  /** ISO-8601 device time of the fix. */
  recorded_at: string;
  /** ISO-8601 server time the update was received. */
  received_at: string;
}

/** Successful payload of `GET /api/v1/trips/:tripId/location`. */
export interface TripLocationLatestResponse extends TripLocationResponse {
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
}

/** Query string of `GET /api/v1/trips/:tripId/location/history`. */
export interface TripLocationHistoryQuery {
  /** Inclusive ISO-8601 lower bound on `recorded_at`. */
  from?: string;
  /** Inclusive ISO-8601 upper bound on `recorded_at`. */
  to?: string;
  /** Maximum number of fixes (1..500, default 100). */
  limit?: number;
}

/**
 * Successful payload of `GET /api/v1/trips/:tripId/location/history`.
 *
 * Items are ordered chronologically (oldest fix first) so a client can draw
 * the travelled path directly; `has_more` signals that the window continues
 * past the newest returned fix.
 */
export interface TripLocationHistoryResponse {
  trip_id: string;
  school_id: string;
  items: TripLocationResponse[];
  /** True when further fixes exist after the last returned item. */
  has_more: boolean;
}

/**
 * Socket.IO contract for live tracking.
 *
 * The gateway lives in its own namespace so the tracking socket surface stays
 * separate from any future chat/notification namespaces. Every socket must
 * authenticate with the same JWT bearer token as the HTTP API
 * (`handshake.auth.access_token`); a socket without a valid token is
 * disconnected immediately.
 *
 * Rooms are named `trip:<tripId>` (see {@link liveTrackingRoomName}). Room
 * membership is the only authorization boundary for broadcasts: a socket can
 * enter the room only after the server has verified that its user may observe
 * that specific trip, and it must repeat that handshake after every
 * reconnect.
 */
export const LIVE_TRACKING_NAMESPACE = '/live-tracking';

/** Socket.IO event names of the live tracking namespace. */
export const LIVE_TRACKING_EVENTS = {
  /** Client → server: request membership in one trip's room. */
  join: 'tracking:join',
  /** Client → server: leave a trip's room again. */
  leave: 'tracking:leave',
  /** Crew → server: one GPS fix; server → room: the accepted fix. */
  locationUpdate: 'trip:location:update',
  /** Server → room: the trip entered a state where tracking can run. */
  trackingStarted: 'trip:tracking:started',
  /** Server → room: the trip reached a terminal state; tracking has stopped. */
  trackingStopped: 'trip:tracking:stopped',
} as const;

export type LiveTrackingEvent = (typeof LIVE_TRACKING_EVENTS)[keyof typeof LIVE_TRACKING_EVENTS];

/**
 * Room name for one trip. Centralised so client and server can never drift on
 * the naming scheme; the value is always built server-side from a verified
 * trip id, never from raw client input.
 */
export const liveTrackingRoomName = (tripId: string): string => `trip:${tripId}`;

/** Body of the `tracking:join` event. */
export interface TrackingJoinPayload {
  trip_id: string;
}

/** Why a `tracking:join` request was refused. */
export type TrackingJoinDenialReason =
  'unauthenticated' | 'invalid_payload' | 'unauthorized' | 'trip_not_found' | 'trip_not_open';

/** Ack of `tracking:join`. */
export interface TrackingJoinAck {
  status: 'joined' | 'denied';
  trip_id: string;
  /**
   * The room the socket entered. On a denied join this is the room that
   * would have been entered (or `unknown` when the payload was unparseable).
   */
  room: string;
  /** Present only when `status` is `joined`. */
  trip_status?: TripStatus;
  tracking_state?: TripTrackingState;
  /** Present only when `status` is `joined`: the current latest fix, or `null` while the trip has not moved yet. */
  latest?: TripLocationResponse | null;
  /** Present only when `status` is `denied`. */
  reason?: TrackingJoinDenialReason;
}

/** Body of the `tracking:leave` event. */
export interface TrackingLeavePayload {
  trip_id: string;
}

/** Ack of `tracking:leave`. */
export interface TrackingLeaveAck {
  status: 'left' | 'not_joined';
  trip_id: string;
}

/**
 * Crew → server body of `trip:location:update`.
 *
 * Deliberately contains only the GPS data: no `school_id`, no crew id, no bus
 * or route id and no server receipt time — all of those are derived by the
 * server from the JWT and the trip record.
 */
export interface TripLocationUpdatePayload extends GpsLocationFix {
  trip_id: string;
}

/** Why a `trip:location:update` was refused (the socket stays connected). */
export type TripLocationUpdateRejectionReason =
  | 'unauthenticated'
  | 'unauthorized'
  | 'trip_not_found'
  | 'trip_not_open'
  | 'invalid_payload'
  | 'invalid_timestamp'
  | 'future_timestamp'
  | 'throttled';

/** Ack of `trip:location:update`. */
export interface TripLocationUpdateAck {
  status: 'accepted' | 'rejected';
  trip_id: string;
  /** Server receipt time, present for accepted updates. */
  received_at?: string;
  /**
   * Accepted updates only: `true` when this fix is not the latest one (an
   * older or equal timestamp arrived out of order). It is kept for the
   * history but does not move the live position forward.
   */
  stale?: boolean;
  /** Present only when `status` is `rejected`. */
  reason?: TripLocationUpdateRejectionReason;
}

/** Server → room broadcast of an accepted, latest GPS fix. */
export interface TripLocationUpdateEvent {
  trip_id: string;
  school_id: string;
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  /** ISO-8601 device time of the fix. */
  recorded_at: string;
  /** ISO-8601 server time the fix was received (authoritative receipt time). */
  received_at: string;
}

/** Server → room: tracking became possible (trip entered BOARDING/IN_PROGRESS). */
export interface TripTrackingStartedEvent {
  trip_id: string;
  school_id: string;
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
  /** ISO-8601 server time of the transition. */
  at: string;
}

/** Server → room: the trip is terminal and will never accept GPS updates. */
export interface TripTrackingStoppedEvent {
  trip_id: string;
  school_id: string;
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
  reason: 'completed' | 'cancelled' | 'deleted';
  /** ISO-8601 server time of the transition. */
  at: string;
}

/**
 * Phase 2 — Bus, route and stop management.
 *
 * The school admin manages the fleet (`/buses`), the route plan (`/routes`)
 * and the ordered boarding points (`/stops`). `school_id` is never accepted
 * from the client: the API derives it exclusively from the authenticated
 * user's JWT claims and returns it on every response as the tenant anchor.
 */

/** Body of `POST /api/v1/buses`. */
export interface BusCreateRequest {
  /** Licence plate / government registration — unique inside a school. */
  registration_number: string;
  /** Optional operator fleet number painted on the vehicle. */
  bus_number?: string | null;
  /** Seated capacity including the conductor; must be at least 1. */
  capacity: number;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/buses/:id` — every field is optional. */
export interface BusUpdateRequest {
  registration_number?: string;
  bus_number?: string | null;
  capacity?: number;
  is_active?: boolean;
}

/** Public projection of a bus owned by the authenticated school. */
export interface BusResponse {
  id: string;
  school_id: string;
  registration_number: string;
  bus_number: string | null;
  capacity: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/buses`. */
export interface BusListResponse {
  items: BusResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/buses/:id`. */
export interface BusDeleteResponse {
  id: string;
  message: string;
}

/** Query string of `GET /api/v1/buses`. */
export interface BusListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

/** Body of `POST /api/v1/routes`. */
export interface RouteCreateRequest {
  name: string;
  /** Short stable code shown on the bus sign — unique inside a school. */
  code: string;
  description?: string | null;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/routes/:id` — every field is optional. */
export interface RouteUpdateRequest {
  name?: string;
  code?: string;
  description?: string | null;
  is_active?: boolean;
}

/** Public projection of a route owned by the authenticated school. */
export interface RouteResponse {
  id: string;
  school_id: string;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/routes`. */
export interface RouteListResponse {
  items: RouteResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/routes/:id`. */
export interface RouteDeleteResponse {
  id: string;
  message: string;
}

/** Query string of `GET /api/v1/routes`. */
export interface RouteListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

/**
 * Body of `PUT /api/v1/routes/:id/stops` — the full ordered stop manifest.
 *
 * The array must contain every active stop of the route exactly once; the API
 * renumbers the stops 1..N in the given order inside a transaction.
 */
export interface RouteStopsOrderRequest {
  stop_ids: string[];
}

/** Successful payload of `GET /api/v1/routes/:id/stops` (and the reorder). */
export interface RouteStopsListResponse {
  items: StopResponse[];
}

/** Body of `POST /api/v1/stops`. */
export interface StopCreateRequest {
  /** Target route; must belong to the authenticated school. */
  route_id: string;
  name: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Geofence radius in metres (10..2000); defaults to 100. */
  geofence_radius_meters?: number;
  /**
   * 1-based position on the route, unique per route. When omitted the API
   * appends the stop at the end of the route.
   */
  sequence_number?: number;
  /** Local wall-clock arrival, `HH:MM` or `HH:MM:SS`. */
  estimated_arrival_time?: string | null;
  is_active?: boolean;
}

/** Body of `PATCH /api/v1/stops/:id` — every field is optional. */
export interface StopUpdateRequest {
  route_id?: string;
  name?: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  geofence_radius_meters?: number;
  sequence_number?: number;
  estimated_arrival_time?: string | null;
  is_active?: boolean;
}

/** Public projection of a stop owned by the authenticated school. */
export interface StopResponse {
  id: string;
  school_id: string;
  route_id: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  geofence_radius_meters: number;
  sequence_number: number;
  estimated_arrival_time: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/stops`. */
export interface StopListResponse {
  items: StopResponse[];
  meta: PaginationMeta;
}

/** Successful payload of `DELETE /api/v1/stops/:id`. */
export interface StopDeleteResponse {
  id: string;
  message: string;
}

/** Query string of `GET /api/v1/stops`. */
export interface StopListQuery {
  page?: number;
  limit?: number;
  search?: string;
  /** Optional filter: only stops of this route. */
  route_id?: string;
}

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  subdomain?: string;
}

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}
