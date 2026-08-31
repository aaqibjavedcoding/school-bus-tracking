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
 * Compact subscription block embedded in the school list/details payloads.
 *
 * Originally a pure placeholder that always reported `status: 'none'`. Since
 * Task 42 it is filled in from the real `school_subscriptions` record when one
 * exists, and **still reports the exact same `status: 'none'`, `plan: null`,
 * `current_period_end: null` shape for a school without a subscription**, so
 * existing consumers keep working unchanged.
 *
 * `SubscriptionStatus` / `AdminSchoolSubscriptionPlanRef` are declared in the
 * Task 42 section at the bottom of this file (enum declarations are hoisted at
 * runtime, and types are resolution-order independent).
 */
export interface AdminSchoolSubscriptionInfo {
  status: SubscriptionStatus;
  /** Minimal plan reference resolved from the Plans domain; never stored. */
  plan: AdminSchoolSubscriptionPlanRef | null;
  /** ISO-8601 end of the current billing period; `null` when open-ended. */
  current_period_end: string | null;
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
  /**
   * Subscription block — always present. Reports `status: 'none'` for a
   * school that has no subscription record yet.
   */
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
  // --- Human-readable display fields (populated by the API) ---
  /** Resolved home stop label, e.g. \"Maple St & 5th Ave\". */
  home_stop_name?: string | null;
  /** Route the student's home stop belongs to. */
  route_id?: string | null;
  route_name?: string | null;
  route_code?: string | null;
  /** Fleet number of the bus currently rostered to the student's route. */
  bus_number?: string | null;
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
 * Phase 6 (Task 20) — Parent Portal.
 *
 * Everything below is served under `/api/v1/parent/*` and is reachable only
 * by an authenticated `PARENT` (JwtAuthGuard + RolesGuard). Every handler
 * derives both the tenant (`school_id`) and the parent identity (`id`) from
 * the verified JWT claims — a client-supplied `parent_id` or `school_id` is
 * never trusted. A child is only returned when the authenticated parent holds
 * an **active** `StudentGuardian` link to it inside the same school; anything
 * else collapses to a generic 404 so another family's children and another
 * school's students are indistinguishable from "does not exist".
 *
 * These projections are read-only. Attendance, trips, buses, routes and staff
 * remain managed through their existing school-admin / crew surfaces; the
 * parent portal never exposes write endpoints and never returns credentials
 * or boarding/drop mutation controls.
 */

/** Vehicle summary shown to a parent (no fleet internals beyond the facts). */
export interface ParentBusSummary {
  id: string;
  registration_number: string;
  bus_number: string | null;
}

/** Crew member summary shown to a parent (name only — no account internals). */
export interface ParentCrewSummary {
  id: string;
  first_name: string;
  last_name: string;
}

/** Home stop of a child with the route it belongs to. */
export interface ParentHomeStopSummary {
  id: string | null;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  sequence_number: number | null;
  /** Route the stop belongs to; `null` when the child has no home stop. */
  route_id: string | null;
  route_code: string | null;
  route_name: string | null;
}

/** A parent's read-only view of one of their children, including today's run. */
export interface ParentChildSummary {
  id: string;
  school_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  grade_level: string | null;
  is_active: boolean;
  /** Human-readable relationship from the guardian link, e.g. "Mother". */
  relationship: string;
  can_pick_up: boolean;
  is_primary: boolean;
  home_stop: ParentHomeStopSummary;
  today: ParentChildToday;
}

/** Today's trip + attendance + bus for one child. `trip` is null on rest days. */
export interface ParentChildToday {
  /** The child's trip today (on their home-stop route) or `null`. */
  trip: TripResponse | null;
  /** The child's attendance on that trip, or `null` while PENDING. */
  attendance: TripStudentAttendanceResponse | null;
  bus: ParentBusSummary | null;
}

/** Successful payload of `GET /api/v1/parent/children`. */
export interface ParentChildListResponse {
  items: ParentChildSummary[];
  count: number;
}

/** Single-child detail: summary plus the crew of today's trip. */
export interface ParentChildDetailResponse extends ParentChildSummary {
  driver: ParentCrewSummary | null;
  conductor: ParentCrewSummary | null;
}

/** Successful payload of `GET /api/v1/parent/children/:id/today`. */
export interface ParentChildTodayResponse {
  child: ParentChildSummary;
  driver: ParentCrewSummary | null;
  conductor: ParentCrewSummary | null;
  /** Ordered stops of the child's route (used to draw the map). */
  stops: StopResponse[];
}

/**
 * Successful payload of `GET /api/v1/parent/children/:id/tracking`.
 *
 * `trip` is the child's active (or most relevant) trip today; `latest` is the
 * latest GPS fix of that trip, or `null` while no fix exists yet (never a
 * fabricated location); `eta` is the approximate ETA/progress summary of the
 * same trip (Task 22), or `null` when there is no trip to compute it for.
 */
export interface ParentTrackingResponse {
  child: ParentChildSummary;
  trip: TripResponse | null;
  driver: ParentCrewSummary | null;
  conductor: ParentCrewSummary | null;
  stops: StopResponse[];
  latest: TripLocationLatestResponse | null;
  eta: TripEtaResponse | null;
}

/** Successful payload of `GET /api/v1/parent/dashboard`. */
export interface ParentDashboardResponse {
  parent: AuthenticatedUser;
  school: { id: string; name: string; code: string; is_active: boolean } | null;
  children: ParentChildSummary[];
  count: number;
}

/**
 * Task 21 — Parent real-time notifications & trip alerts.
 *
 * A notification is a tenant-scoped, user-scoped record: it always belongs to
 * exactly one `(school_id, user_id)` pair, and both values are derived from
 * the verified JWT — never from client input. Parents read their own
 * notifications through `/api/v1/parent/notifications`; the realtime surface
 * (see {@link NOTIFICATIONS_NAMESPACE}) pushes newly created ones to the
 * connected parent's private room.
 *
 * Push-channel (FCM, APNs, SMS, email) delivery is intentionally out of scope
 * for this phase; ETA and geofence arrival notifications arrive with Task 22.
 */

/** Kinds of notification the system can create (strict enum, persisted). */
export enum NotificationType {
  /** A linked child was confirmed onto the bus by the crew. */
  STUDENT_BOARDED = 'STUDENT_BOARDED',
  /** A linked child was dropped off safely. */
  STUDENT_DROPPED = 'STUDENT_DROPPED',
  /** The child's trip opened boarding (SCHEDULED → BOARDING). */
  TRIP_BOARDING = 'TRIP_BOARDING',
  /** The child's bus departed (BOARDING → IN_PROGRESS). */
  TRIP_IN_PROGRESS = 'TRIP_IN_PROGRESS',
  /** The child's trip finished (IN_PROGRESS → COMPLETED). */
  TRIP_COMPLETED = 'TRIP_COMPLETED',
  /** The child's trip was cancelled. */
  TRIP_CANCELLED = 'TRIP_CANCELLED',
  /** The bus entered the geofence of the stop the child uses (Task 22). */
  STOP_ARRIVED = 'STOP_ARRIVED',
}

export const NOTIFICATION_TYPE_VALUES: NotificationType[] = Object.values(NotificationType);

/** Parent-facing read-state filter of `GET /api/v1/parent/notifications`. */
export enum NotificationReadFilter {
  READ = 'read',
  UNREAD = 'unread',
}

export const NOTIFICATION_READ_FILTER_VALUES: NotificationReadFilter[] =
  Object.values(NotificationReadFilter);

/** Parent-facing projection of one stored notification. */
export interface NotificationResponse {
  id: string;
  school_id: string;
  /** The recipient parent's User.id — always the authenticated caller's own. */
  user_id: string;
  type: NotificationType;
  /** Trip the event happened on, when the event is trip-scoped. */
  trip_id: string | null;
  /** Child the event is about, when the event is student-scoped. */
  student_id: string | null;
  /** Stop the event is about, when the event is stop-scoped (arrivals). */
  stop_id: string | null;
  title: string;
  message: string;
  /** Additional event-specific data (student name, trip status, …). */
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
  read_at: string | null;
}

/** Query string of `GET /api/v1/parent/notifications`. */
export interface ParentNotificationListQuery {
  page?: number;
  limit?: number;
  /** `read` / `unread`. Omit for all notifications. */
  status?: NotificationReadFilter;
}

/** Successful payload of `GET /api/v1/parent/notifications`. */
export interface ParentNotificationListResponse {
  items: NotificationResponse[];
  /** Total notifications matching the query (across all pages). */
  total: number;
  /** Total unread notifications of the parent, independent of the filter. */
  unread_count: number;
}

/** Successful payload of `PATCH /api/v1/parent/notifications/read-all`. */
export interface NotificationReadAllResponse {
  /** Number of notifications that moved from unread to read. */
  updated_count: number;
}

/**
 * Socket.IO contract for parent notifications.
 *
 * The gateway lives in its own namespace (`/notifications`) and reuses the
 * exact handshake authentication of `/live-tracking`: the same JWT bearer
 * token in `handshake.auth.access_token`, verified with the same centrally
 * configured `JwtService` and the same payload rule as `JwtAuthGuard`.
 *
 * There is deliberately no client-driven subscribe event: after a successful
 * handshake the server itself places an authenticated `PARENT` socket into
 * the private room {@link notificationRoomName} of *its own* JWT subject. A
 * client can therefore never subscribe to another parent's room — there is
 * simply no way to express it.
 */
export const NOTIFICATIONS_NAMESPACE = '/notifications';

/** Socket.IO event names of the notifications namespace. */
export const NOTIFICATION_EVENTS = {
  /** Server → parent room: a new notification was created for this parent. */
  new: 'notification:new',
} as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

/**
 * Private room of one parent. Centralised so server and clients can never
 * drift on the naming scheme; the parent id always comes from the verified
 * JWT subject, never from a client payload.
 */
export const notificationRoomName = (userId: string): string => `notification:user:${userId}`;

/** Server → parent room payload of `notification:new`. */
export interface NotificationRealtimeEvent {
  notification_id: string;
  type: NotificationType;
  title: string;
  message: string;
  student_id: string | null;
  trip_id: string | null;
  /** Stop the event is about, when the event is stop-scoped (arrivals). */
  stop_id: string | null;
  /** ISO-8601 server time at which the notification was created. */
  created_at: string;
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
  // --- Human-readable display fields (populated by the API) ---
  /** Fleet number of the bus the crew member is currently rostered to. */
  assigned_bus_number?: string | null;
  assigned_bus_registration?: string | null;
  assigned_route_name?: string | null;
  assigned_route_code?: string | null;
  /** Status of the crew member's active trip today, when one exists. */
  current_trip_status?: TripStatus | null;
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
  // --- Human-readable display fields (populated by the API) ---
  route_name?: string | null;
  route_code?: string | null;
  bus_number?: string | null;
  bus_registration_number?: string | null;
  user_name?: string | null;
  user_email?: string | null;
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
  /** Free-text filter over route, bus and crew-member names. */
  search?: string;
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
  // --- Human-readable display fields (populated by the API) ---
  route_name?: string | null;
  route_code?: string | null;
  bus_number?: string | null;
  registration_number?: string | null;
  driver_name?: string | null;
  conductor_name?: string | null;
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
  /** Free-text filter over route code/name, bus number/registration and crew names. */
  search?: string;
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
  /** Server → room: the bus entered a stop's geofence (Task 22 arrival). */
  stopArrived: 'trip:stop:arrived',
  /** Server → room: the approximate trip ETA was recomputed (Task 22). */
  etaUpdate: 'trip:eta:update',
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
 * Task 22 — Dynamic ETA, stop geofence arrivals and stop arrival detection.
 *
 * The ETA is an *approximate, GPS-based* estimate: straight-line (Haversine)
 * distances along the ordered stop polyline divided by the device speed (or a
 * configured fallback speed when the device reports none). It never claims
 * road-routing accuracy and it is never fabricated — without a GPS fix no
 * distance or ETA exists and `eta_available` is false.
 */

/** ETA/progress of one stop of the trip's route, in route order. */
export interface TripStopEta {
  stop_id: string;
  stop_name: string;
  sequence_number: number;
  /** Straight-line (Haversine) metres from the bus along the stop path; null without a GPS fix. */
  distance_meters: number | null;
  /**
   * Whole minutes until the bus reaches the stop (>= 1 while moving), rounded
   * up; null without a GPS fix (an ETA is never invented).
   */
  eta_minutes: number | null;
  /** True when this trip-stop visit has already produced an arrival event. */
  arrived: boolean;
}

/** Successful payload of `GET /api/v1/trips/:tripId/eta`. */
export interface TripEtaResponse {
  trip_id: string;
  school_id: string;
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
  /** Latest accepted GPS fix, or null while the bus has never reported. */
  latest: TripLocationResponse | null;
  /**
   * Effective speed (km/h) used for the ETA: the device speed when it is
   * positive, otherwise the configured fallback. Null only without a fix.
   */
  speed_kmh: number | null;
  /** Where the effective speed came from: the device or the fallback constant. */
  speed_source: 'gps' | 'fallback' | null;
  /** The most recently reached stop (arrival recorded), or null before the first. */
  current_stop: TripStopEta | null;
  /** The first not-yet-reached stop in route order, or null when all are reached. */
  next_stop: TripStopEta | null;
  /** Every route stop in order with its distance / ETA / arrival state. */
  items: TripStopEta[];
  /** False exactly when no GPS fix exists — no ETA is fabricated in that case. */
  eta_available: boolean;
}

/** One persisted stop-arrival event of a trip. */
export interface TripStopArrivalResponse {
  id: string;
  school_id: string;
  trip_id: string;
  stop_id: string;
  stop_name: string;
  /** ISO-8601 server time at which the arrival was recorded. */
  arrived_at: string;
  /** GPS position of the bus at the moment it entered the stop's geofence. */
  latitude: number;
  longitude: number;
  /** Straight-line (Haversine) metres between the bus and the stop at arrival. */
  distance_meters: number;
  created_at: string;
}

/** Successful payload of `GET /api/v1/trips/:tripId/arrivals`. */
export interface TripStopArrivalListResponse {
  trip_id: string;
  school_id: string;
  items: TripStopArrivalResponse[];
}

/**
 * Crew-facing progress snapshot of `GET /api/v1/trips/:tripId/progress`:
 * the latest arrival state plus the next stop and the trip's ETA summary.
 */
export interface TripProgressResponse {
  trip_id: string;
  school_id: string;
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
  /** The most recently reached stop, or null before the first. */
  current_stop: TripStopEta | null;
  /** The first not-yet-reached stop in route order, or null when all are reached. */
  next_stop: TripStopEta | null;
  /** Every recorded arrival of this trip, in arrival order. */
  arrivals: TripStopArrivalResponse[];
  /** The ETA summary (same shape as `GET /trips/:tripId/eta`). */
  eta: TripEtaResponse;
}

/** Server → room: the bus entered a stop's geofence and the visit was recorded. */
export interface TripStopArrivedEvent {
  trip_id: string;
  school_id: string;
  trip_status: TripStatus;
  tracking_state: TripTrackingState;
  stop_id: string;
  stop_name: string;
  sequence_number: number;
  /** ISO-8601 server time at which the arrival was recorded. */
  arrived_at: string;
  /** GPS position of the bus when it entered the geofence. */
  latitude: number;
  longitude: number;
  /** Straight-line (Haversine) metres between the bus and the stop at arrival. */
  distance_meters: number;
}

/** Server → room: the approximate ETA of the trip was recomputed after a fix. */
export interface TripEtaUpdateEvent {
  trip_id: string;
  school_id: string;
  eta: TripEtaResponse;
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
  // --- Human-readable display fields (populated by the API) ---
  /** Route the bus is currently rostered to (via an active assignment). */
  assigned_route_name?: string | null;
  assigned_route_code?: string | null;
  assigned_driver_name?: string | null;
  assigned_conductor_name?: string | null;
  /** Status of the bus's active trip today, when one exists. */
  current_trip_status?: TripStatus | null;
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
  // --- Human-readable display fields (populated by the API) ---
  /** Crew and vehicle currently rostered to the route (active assignments). */
  driver_name?: string | null;
  conductor_name?: string | null;
  bus_number?: string | null;
  bus_registration_number?: string | null;
  /** Number of active students whose home stop sits on this route. */
  student_count?: number | null;
  /** Status of the route's active trip today, when one exists. */
  current_trip_status?: TripStatus | null;
}

/** A student shown on a route detail screen (derived from home stops). */
export interface RouteStudentSummary {
  id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  grade_level: string | null;
  stop_id: string | null;
  stop_name: string | null;
  stop_sequence_number: number | null;
}

/**
 * Full route detail payload of `GET /api/v1/routes/:id/details`: the route
 * facts plus the crew/vehicle roster, the ordered stops, the students whose
 * home stop belongs to the route and the route's active trip today (if any).
 */
export interface RouteDetailResponse {
  route: RouteResponse;
  stops: StopResponse[];
  students: RouteStudentSummary[];
  active_trip: TripResponse | null;
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

/**
 * Task 41 — Commercial SaaS: Subscription Plan foundation.
 *
 * Plans are platform-level catalog entries managed exclusively by the
 * SUPER_ADMIN. They describe a commercial tier that future school
 * subscriptions will reference. No billing/subscription lifecycle is
 * implemented in this phase — the plan catalog is the foundation on which
 * School Subscriptions → Feature Access → Usage Limits will be built.
 */

/** Billing cadence of a plan. */
export enum PlanBillingPeriod {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export const PLAN_BILLING_PERIOD_VALUES: PlanBillingPeriod[] = Object.values(PlanBillingPeriod);

/**
 * Known feature flags a plan may expose.
 *
 * The catalog is stored as a plain JSON object (`{ featureKey: boolean }`)
 * rather than a dozen boolean columns, so new capabilities can be added
 * without schema changes. This enum is the documented set of known keys the
 * UI and authorization layer understand; unknown keys are preserved by the
 * API so gradual rollout is safe.
 */
export enum PlanFeature {
  LIVE_TRACKING = 'live_tracking',
  ETA = 'eta',
  GEOFENCE_STOP_ARRIVAL = 'geofence_stop_arrival',
  ATTENDANCE = 'attendance',
  NOTIFICATIONS = 'notifications',
  PARENT_PORTAL = 'parent_portal',
  ADVANCED_REPORTS = 'advanced_reports',
  ANALYTICS = 'analytics',
}

export const PLAN_FEATURE_VALUES: PlanFeature[] = Object.values(PlanFeature);

/** Human-readable labels for plan features (used by UI forms/displays). */
export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  [PlanFeature.LIVE_TRACKING]: 'Live GPS Tracking',
  [PlanFeature.ETA]: 'Estimated Time of Arrival (ETA)',
  [PlanFeature.GEOFENCE_STOP_ARRIVAL]: 'Geofence / Stop Arrival Alerts',
  [PlanFeature.ATTENDANCE]: 'Trip Attendance',
  [PlanFeature.NOTIFICATIONS]: 'Parent Notifications',
  [PlanFeature.PARENT_PORTAL]: 'Parent Portal',
  [PlanFeature.ADVANCED_REPORTS]: 'Advanced Reports',
  [PlanFeature.ANALYTICS]: 'Analytics Dashboard',
};

export type PlanFeaturesConfig = Partial<Record<PlanFeature, boolean>> & {
  [key: string]: boolean | undefined;
};

/**
 * Known resource categories constrained by plan usage limits.
 *
 * Like features, limits are persisted as JSON (`{ resourceKey: limit }`) so
 * new resources can be added without schema migrations.
 */
export enum PlanLimitResource {
  STUDENTS = 'students',
  BUSES = 'buses',
  ROUTES = 'routes',
  DRIVERS = 'drivers',
  CONDUCTORS = 'conductors',
  STAFF = 'staff',
  TRIPS = 'trips',
}

export const PLAN_LIMIT_RESOURCE_VALUES: PlanLimitResource[] = Object.values(PlanLimitResource);

/** Human-readable labels for plan resources (used by UI forms/displays). */
export const PLAN_LIMIT_RESOURCE_LABELS: Record<PlanLimitResource, string> = {
  [PlanLimitResource.STUDENTS]: 'Students',
  [PlanLimitResource.BUSES]: 'Buses',
  [PlanLimitResource.ROUTES]: 'Routes',
  [PlanLimitResource.DRIVERS]: 'Drivers',
  [PlanLimitResource.CONDUCTORS]: 'Conductors',
  [PlanLimitResource.STAFF]: 'Staff',
  [PlanLimitResource.TRIPS]: 'Trips',
};

/** A single numeric limit; `unlimited: true` overrides `value`. */
export interface PlanLimitValue {
  unlimited: boolean;
  /** Hard cap; ignored when `unlimited` is true. Must be >= 0 when set. */
  value: number | null;
}

export type PlanLimitsConfig = Partial<Record<PlanLimitResource, PlanLimitValue>> & {
  [key: string]: PlanLimitValue | undefined;
};

/** Lifecycle state of a plan as shown in the platform console. */
export type AdminPlanStatus = 'active' | 'inactive';

/** Public projection of a plan. Never contains internal ORM state. */
export interface AdminPlanResponse {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price: string;
  currency: string;
  billing_period: PlanBillingPeriod;
  is_active: boolean;
  status: AdminPlanStatus;
  features: PlanFeaturesConfig;
  limits: PlanLimitsConfig;
  created_at: string;
  updated_at: string;
}

/** One row of the plan list with a small feature/limit summary. */
export interface AdminPlanSummary extends AdminPlanResponse {
  /** Short summary of enabled features for the list view. */
  feature_summary: string[];
  /** Short summary of key limits for the list view. */
  limit_summary: Array<{ resource: PlanLimitResource; label: string; display: string }>;
}

/** Query string of `GET /api/v1/admin/plans`. */
export interface AdminPlanListQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdminPlanStatus;
  sort?: 'created_at' | 'name' | 'code' | 'price';
  order?: 'asc' | 'desc';
}

/** Successful payload of `GET /api/v1/admin/plans`. */
export interface AdminPlanListResponse {
  items: AdminPlanSummary[];
  meta: PaginationMeta;
}

/** Body of `POST /api/v1/admin/plans`. */
export interface AdminPlanCreateRequest {
  code: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  billing_period: PlanBillingPeriod;
  is_active?: boolean;
  features?: PlanFeaturesConfig;
  limits?: PlanLimitsConfig;
}

/** Body of `PATCH /api/v1/admin/plans/:id`. */
export interface AdminPlanUpdateRequest {
  name?: string;
  description?: string | null;
  price?: number;
  currency?: string;
  billing_period?: PlanBillingPeriod;
  is_active?: boolean;
  features?: PlanFeaturesConfig;
  limits?: PlanLimitsConfig;
}

/** Body/response of the activate/deactivate lifecycle endpoints. */
export interface AdminPlanLifecycleResponse {
  id: string;
  status: AdminPlanStatus;
  is_active: boolean;
  message: string;
}

/**
 * Task 42 — School Subscriptions (Step 1: backend foundation).
 *
 * A `school_subscriptions` record maps one School to one Plan of the Task 41
 * catalog together with the lifecycle state (status, trial window, current
 * period, cancellation). The subscription row **never copies** plan name,
 * code, price, features or limits — those are always resolved through
 * `plan_id` from the Plans domain, so a plan edit is immediately reflected
 * everywhere.
 *
 * No payment/billing functionality is implemented in this phase: the shapes
 * below are deliberately payment-compatible (status values, period window,
 * cancellation timestamp) but nothing here charges, invoices or renews.
 */

/** Lifecycle state of a school subscription. */
export enum SubscriptionStatus {
  /**
   * Projection-only state: the school has **no** subscription record at all.
   * It is never persisted in `school_subscriptions` (a database CHECK
   * constraint rejects it) — it exists so the API can report a clean,
   * non-error "no subscription" state, exactly as before Task 42.
   */
  NONE = 'none',
  /** Inside a trial window; access is granted, nothing is charged. */
  TRIALING = 'trialing',
  /** Paid/among granted access for the current period. */
  ACTIVE = 'active',
  /** Payment overdue (future billing phase); access decisions deferred. */
  PAST_DUE = 'past_due',
  /** Cancelled by an operator; kept for history. */
  CANCELLED = 'cancelled',
  /** The current period ended and was not renewed. */
  EXPIRED = 'expired',
}

export const SUBSCRIPTION_STATUS_VALUES: SubscriptionStatus[] =
  Object.values(SubscriptionStatus);

/** Statuses a persisted `school_subscriptions` row may hold (`none` excluded). */
export type PersistedSubscriptionStatus = Exclude<SubscriptionStatus, SubscriptionStatus.NONE>;

export const PERSISTED_SUBSCRIPTION_STATUS_VALUES: PersistedSubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
  SubscriptionStatus.CANCELLED,
  SubscriptionStatus.EXPIRED,
];

/**
 * Statuses that make a subscription the school's *current* one. Exactly one
 * subscription per school may hold one of these at any time — enforced by a
 * partial unique index and by the service layer.
 */
export const LIVE_SUBSCRIPTION_STATUS_VALUES: PersistedSubscriptionStatus[] = [
  SubscriptionStatus.TRIALING,
  SubscriptionStatus.ACTIVE,
  SubscriptionStatus.PAST_DUE,
];

/** Statuses a Super Admin may assign when creating a subscription. */
export const ASSIGNABLE_SUBSCRIPTION_STATUS_VALUES: PersistedSubscriptionStatus[] = [
  ...LIVE_SUBSCRIPTION_STATUS_VALUES,
];

/** Terminal statuses — historical rows that no longer grant access. */
export const TERMINAL_SUBSCRIPTION_STATUS_VALUES: PersistedSubscriptionStatus[] = [
  SubscriptionStatus.CANCELLED,
  SubscriptionStatus.EXPIRED,
];

/** Human-readable labels for subscription statuses (UI displays). */
export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  [SubscriptionStatus.NONE]: 'No subscription',
  [SubscriptionStatus.TRIALING]: 'Trialing',
  [SubscriptionStatus.ACTIVE]: 'Active',
  [SubscriptionStatus.PAST_DUE]: 'Past due',
  [SubscriptionStatus.CANCELLED]: 'Cancelled',
  [SubscriptionStatus.EXPIRED]: 'Expired',
};

/**
 * Minimal plan reference embedded in compact subscription projections.
 *
 * Always derived at read time from the referenced plan — never persisted on
 * the subscription row.
 */
export interface AdminSchoolSubscriptionPlanRef {
  id: string;
  code: string;
  name: string;
  /** Decimal string with two fraction digits, e.g. `"19.99"`. */
  price: string;
  currency: string;
  billing_period: PlanBillingPeriod;
  is_active: boolean;
}

/**
 * Full subscription projection of
 * `GET|POST|PATCH /api/v1/admin/schools/:schoolId/subscription`.
 *
 * For a school without a subscription every field except `school_id` and
 * `status` (`'none'`) is `null` — a clean state, never an error.
 */
export interface AdminSchoolSubscriptionResponse {
  /** `null` in the `none` state. */
  id: string | null;
  school_id: string;
  status: SubscriptionStatus;
  plan_id: string | null;
  /** Full plan definition resolved from the Plans domain. */
  plan: AdminPlanResponse | null;
  /** Convenience mirrors of the plan's commercial terms (read-time only). */
  price: string | null;
  currency: string | null;
  billing_period: PlanBillingPeriod | null;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription`. */
export interface AdminSchoolSubscriptionCreateRequest {
  /** Must reference an existing **active** plan. */
  plan_id: string;
  /** Defaults to `trialing` when trial dates are supplied, else `active`. */
  status?: SubscriptionStatus;
  trial_start?: string | null;
  trial_end?: string | null;
  /** Defaults to "now" when omitted. */
  current_period_start?: string | null;
  /** `null` means open-ended (no renewal date is computed in this phase). */
  current_period_end?: string | null;
}

/**
 * Body of `PATCH /api/v1/admin/schools/:schoolId/subscription`.
 *
 * Changing `plan_id` supersedes the current subscription: the existing row is
 * closed (kept as history) and a new row is created on the new plan.
 */
export interface AdminSchoolSubscriptionUpdateRequest {
  plan_id?: string;
  status?: SubscriptionStatus;
  trial_start?: string | null;
  trial_end?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
}

/** Body of `POST /api/v1/admin/schools/:schoolId/subscription/cancel`. */
export interface AdminSchoolSubscriptionCancelRequest {
  /** Defaults to "now". Cannot precede the subscription start. */
  cancelled_at?: string | null;
}

/**
 * One record of `GET /api/v1/admin/schools/:schoolId/subscription/history`
 * (Task 42, step 2 — Super Admin subscription console).
 *
 * Every subscription row a school has ever had, newest first — the change
 * and cancel flows preserve rows instead of deleting them, and this
 * projection simply exposes that history. The plan is embedded as the
 * compact {@link AdminSchoolSubscriptionPlanRef} (resolved at read time via
 * `plan_id`, never copied onto the subscription), so the payload stays small
 * and one bulk plan lookup serves the whole list.
 */
export interface AdminSchoolSubscriptionHistoryItem {
  id: string;
  school_id: string;
  /** Persisted rows only — the projection-only `none` never appears here. */
  status: PersistedSubscriptionStatus;
  plan_id: string;
  plan: AdminSchoolSubscriptionPlanRef | null;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  /** True when this row is the school's live (trialing/active/past_due) subscription. */
  is_current: boolean;
}

/**
 * Successful payload of `GET /api/v1/admin/schools/:schoolId/subscription/history`.
 *
 * Not paginated: a school accumulates a handful of subscription rows over
 * its lifetime (one per plan change/resubscribe), so the full list is
 * returned in one response — no per-row follow-up requests are ever needed.
 */
export interface AdminSchoolSubscriptionHistoryResponse {
  items: AdminSchoolSubscriptionHistoryItem[];
}

/**
 * Task 44 — Bus & driver document management (compliance documents).
 *
 * A *document* is a compliance record attached to a school-owned resource:
 * a bus (RC, insurance, fitness, permit, PUC, …) or a driver (driving
 * licence, medical certificate, police verification, …).
 *
 * Design rules, shared by both owners:
 *
 * - **Validity is never stored.** Only the real `issue_date` / `expiry_date`
 *   are persisted; `status` is *derived* from those dates on every read (see
 *   `deriveDocumentStatus` in `@school-bus-tracking/validation`). A document
 *   cannot be marked "valid" by hand, so no fake validity is possible.
 * - **A document without an expiry date is `VALID`** — there is nothing for it
 *   to expire against (e.g. a registration certificate issued for life).
 * - **Requirements are configurable per school.** `document_requirements`
 *   stores the school's own required/optional configuration per document
 *   type; types without an explicit row fall back to the built-in catalogue
 *   default (`DEFAULT_BUS_/DRIVER_DOCUMENT_REQUIREMENTS`).
 * - **Everything is tenant-scoped.** Requests never carry a `school_id`; the
 *   API derives it from the verified JWT claims.
 *
 * File handling follows the existing application architecture: there is no
 * binary upload pipeline in the self-hosted stack, so a document stores a
 * *reference* (`file_name` + `file_url`) to a file kept in the school's own
 * document store rather than a blob.
 */

/** Compliance documents a school bus must carry. */
export enum BusDocumentType {
  /** RC — Registration Certificate (vehicle registration book). */
  REGISTRATION_CERTIFICATE = 'REGISTRATION_CERTIFICATE',
  INSURANCE = 'INSURANCE',
  FITNESS_CERTIFICATE = 'FITNESS_CERTIFICATE',
  PERMIT = 'PERMIT',
  /** PUC — Pollution Under Control certificate. */
  POLLUTION_CERTIFICATE = 'POLLUTION_CERTIFICATE',
  OTHER = 'OTHER',
}

export const BUS_DOCUMENT_TYPE_VALUES: BusDocumentType[] = Object.values(BusDocumentType);

export const BUS_DOCUMENT_TYPE_LABELS: Record<BusDocumentType, string> = {
  [BusDocumentType.REGISTRATION_CERTIFICATE]: 'RC / Registration certificate',
  [BusDocumentType.INSURANCE]: 'Insurance',
  [BusDocumentType.FITNESS_CERTIFICATE]: 'Fitness certificate',
  [BusDocumentType.PERMIT]: 'Permit',
  [BusDocumentType.POLLUTION_CERTIFICATE]: 'PUC / Pollution certificate',
  [BusDocumentType.OTHER]: 'Other',
};

/** Compliance documents a driver (or conductor) must carry. */
export enum DriverDocumentType {
  DRIVING_LICENSE = 'DRIVING_LICENSE',
  MEDICAL_CERTIFICATE = 'MEDICAL_CERTIFICATE',
  POLICE_VERIFICATION = 'POLICE_VERIFICATION',
  TRAINING_CERTIFICATE = 'TRAINING_CERTIFICATE',
  ID_PROOF = 'ID_PROOF',
  OTHER = 'OTHER',
}

export const DRIVER_DOCUMENT_TYPE_VALUES: DriverDocumentType[] =
  Object.values(DriverDocumentType);

export const DRIVER_DOCUMENT_TYPE_LABELS: Record<DriverDocumentType, string> = {
  [DriverDocumentType.DRIVING_LICENSE]: 'Driving licence',
  [DriverDocumentType.MEDICAL_CERTIFICATE]: 'Medical certificate',
  [DriverDocumentType.POLICE_VERIFICATION]: 'Police verification',
  [DriverDocumentType.TRAINING_CERTIFICATE]: 'Training certificate',
  [DriverDocumentType.ID_PROOF]: 'ID proof',
  [DriverDocumentType.OTHER]: 'Other',
};

/**
 * Validity of a document, always derived from its expiry date.
 *
 * VALID         → no expiry date, or more than `expiry_warning_days` left
 * EXPIRING_SOON → between today and `expiry_warning_days` left (inclusive)
 * EXPIRED       → the expiry date is before today
 */
export enum DocumentStatus {
  VALID = 'VALID',
  EXPIRING_SOON = 'EXPIRING_SOON',
  EXPIRED = 'EXPIRED',
}

export const DOCUMENT_STATUS_VALUES: DocumentStatus[] = Object.values(DocumentStatus);

export const DOCUMENT_STATUS_LABELS: Record<DocumentStatus, string> = {
  [DocumentStatus.VALID]: 'Valid',
  [DocumentStatus.EXPIRING_SOON]: 'Expiring soon',
  [DocumentStatus.EXPIRED]: 'Expired',
};

/** The two resource kinds a compliance document can be attached to. */
export type DocumentOwnerType = 'BUS' | 'DRIVER';

export const DOCUMENT_OWNER_TYPE_VALUES: DocumentOwnerType[] = ['BUS', 'DRIVER'];

export const DOCUMENT_OWNER_TYPE_LABELS: Record<DocumentOwnerType, string> = {
  BUS: 'Bus',
  DRIVER: 'Driver',
};

/**
 * State of one *requirement* of a resource, i.e. the combination of "is this
 * document type required?" and "what does the newest stored document say?".
 *
 * MISSING → required by the school but no document of that type is on file
 * (an optional type never reports MISSING — it reports nothing at all)
 */
export type DocumentComplianceState = 'MISSING' | 'VALID' | 'EXPIRING_SOON' | 'EXPIRED';

export const DOCUMENT_COMPLIANCE_STATE_VALUES: DocumentComplianceState[] = [
  'MISSING',
  'VALID',
  'EXPIRING_SOON',
  'EXPIRED',
];

export const DOCUMENT_COMPLIANCE_STATE_LABELS: Record<DocumentComplianceState, string> = {
  MISSING: 'Missing',
  VALID: 'Valid',
  EXPIRING_SOON: 'Expiring soon',
  EXPIRED: 'Expired',
};

/** Default lead time (days) used to flag a document as "expiring soon". */
export const DEFAULT_DOCUMENT_EXPIRY_WARNING_DAYS = 30;

/** Built-in required/optional catalogue for bus documents. */
export const DEFAULT_BUS_DOCUMENT_REQUIREMENTS: Record<BusDocumentType, boolean> = {
  [BusDocumentType.REGISTRATION_CERTIFICATE]: true,
  [BusDocumentType.INSURANCE]: true,
  [BusDocumentType.FITNESS_CERTIFICATE]: true,
  [BusDocumentType.PERMIT]: true,
  [BusDocumentType.POLLUTION_CERTIFICATE]: true,
  [BusDocumentType.OTHER]: false,
};

/** Built-in required/optional catalogue for driver documents. */
export const DEFAULT_DRIVER_DOCUMENT_REQUIREMENTS: Record<DriverDocumentType, boolean> = {
  [DriverDocumentType.DRIVING_LICENSE]: true,
  [DriverDocumentType.MEDICAL_CERTIFICATE]: false,
  [DriverDocumentType.POLICE_VERIFICATION]: false,
  [DriverDocumentType.TRAINING_CERTIFICATE]: false,
  [DriverDocumentType.ID_PROOF]: false,
  [DriverDocumentType.OTHER]: false,
};

/** Shared shape of a stored compliance document. */
export interface DocumentFields {
  /** Official number of the document (RC number, policy number, licence no…). */
  document_number: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  notes: string | null;
  /** Display name of the attached file (never the file itself). */
  file_name: string | null;
  /** Reference (URL) to the attached file in the school's own store. */
  file_url: string | null;
}

/** Body of `POST /api/v1/buses/:busId/documents`. */
export interface BusDocumentCreateRequest extends Partial<DocumentFields> {
  document_type: BusDocumentType;
}

/** Body of `PATCH /api/v1/buses/:busId/documents/:id`. */
export interface BusDocumentUpdateRequest extends Partial<DocumentFields> {
  document_type?: BusDocumentType;
}

/** Public projection of one bus compliance document. */
export interface BusDocumentResponse extends DocumentFields {
  id: string;
  school_id: string;
  bus_id: string;
  document_type: BusDocumentType;
  document_type_label: string;
  /** Derived from `expiry_date` on every read — never stored. */
  status: DocumentStatus;
  /** Whole days until expiry (0 = expires today); `null` when undated. */
  days_remaining: number | null;
  /** True when this document type is required for buses in this school. */
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/buses/:busId/documents`. */
export interface BusDocumentListResponse {
  items: BusDocumentResponse[];
  meta: PaginationMeta;
}

/** Body of `POST /api/v1/drivers/:driverId/documents`. */
export interface DriverDocumentCreateRequest extends Partial<DocumentFields> {
  document_type: DriverDocumentType;
}

/** Body of `PATCH /api/v1/drivers/:driverId/documents/:id`. */
export interface DriverDocumentUpdateRequest extends Partial<DocumentFields> {
  document_type?: DriverDocumentType;
}

/** Public projection of one driver compliance document. */
export interface DriverDocumentResponse extends DocumentFields {
  id: string;
  school_id: string;
  driver_id: string;
  document_type: DriverDocumentType;
  document_type_label: string;
  status: DocumentStatus;
  days_remaining: number | null;
  is_required: boolean;
  created_at: string;
  updated_at: string;
}

/** Successful payload of `GET /api/v1/drivers/:driverId/documents`. */
export interface DriverDocumentListResponse {
  items: DriverDocumentResponse[];
  meta: PaginationMeta;
}

/** Successful payload of any document `DELETE`. */
export interface DocumentDeleteResponse {
  id: string;
  message: string;
}

/** Query string of the bus/driver document lists. */
export interface DocumentListQuery {
  page?: number;
  limit?: number;
  /** Only documents of this type. */
  document_type?: string;
  /** `valid` | `expiring_soon` | `expired` | `missing` — server-side derived. */
  status?: DocumentStatus;
}

/** One configured requirement of a document type in one school. */
export interface DocumentRequirement {
  owner_type: DocumentOwnerType;
  document_type: string;
  document_type_label: string;
  is_required: boolean;
  /** Lead time in days used for the "expiring soon" flag. */
  expiry_warning_days: number;
  /** True when the school has overridden the built-in catalogue default. */
  is_customized: boolean;
}

/** Successful payload of `GET /api/v1/document-requirements`. */
export interface DocumentRequirementsResponse {
  owner_type: DocumentOwnerType;
  items: DocumentRequirement[];
}

/** Query string of `GET /api/v1/document-requirements`. */
export interface DocumentRequirementsListQuery {
  owner_type: DocumentOwnerType;
}

/** One requirement a school may override. */
export interface DocumentRequirementInput {
  document_type: string;
  is_required: boolean;
  /** Defaults to the built-in warning window when omitted. */
  expiry_warning_days?: number | null;
}

/** Body of `PUT /api/v1/document-requirements`. */
export interface DocumentRequirementsUpdateRequest {
  owner_type: DocumentOwnerType;
  items: DocumentRequirementInput[];
}

/** Status of one requirement against the documents actually on file. */
export interface DocumentRequirementStatus {
  owner_type: DocumentOwnerType;
  document_type: string;
  document_type_label: string;
  is_required: boolean;
  state: DocumentComplianceState;
  /** Newest document of this type on file; `null` when MISSING. */
  document_id: string | null;
  expiry_date: string | null;
  days_remaining: number | null;
}

/** Counts behind a compliance check. */
export interface DocumentComplianceSummary {
  /** Number of document types the school requires for this resource. */
  required_total: number;
  valid: number;
  expiring_soon: number;
  expired: number;
  missing: number;
  /** True when nothing required is missing, expired or expiring soon. */
  is_compliant: boolean;
}

/** Compliance of one bus or one driver. */
export interface DocumentComplianceResponse {
  owner_type: DocumentOwnerType;
  owner_id: string;
  /** Human label of the owner (registration number / crew member name). */
  owner_label: string;
  summary: DocumentComplianceSummary;
  /** Every requirement — required and optional-with-a-document — in catalogue order. */
  requirements: DocumentRequirementStatus[];
}

/** One row of the school-wide compliance overview. */
export interface DocumentOverviewItem {
  owner_type: DocumentOwnerType;
  owner_id: string;
  owner_label: string;
  summary: DocumentComplianceSummary;
  /** Only the entries that need attention (missing / expiring / expired). */
  issues: DocumentRequirementStatus[];
}

/** Successful payload of `GET /api/v1/documents/overview`. */
export interface DocumentOverviewResponse {
  /** Aggregate over every bus and driver of the school. */
  summary: DocumentComplianceSummary;
  items: DocumentOverviewItem[];
  meta: PaginationMeta;
}

/** Query string of `GET /api/v1/documents/overview`. */
export interface DocumentOverviewQuery {
  page?: number;
  limit?: number;
  owner_type?: DocumentOwnerType;
  /** `compliant` | `attention` — attention = anything missing/expiring/expired. */
  compliance?: 'compliant' | 'attention';
  search?: string;
}

/**
 * Task 44 — Emergency / SOS.
 *
 * Crew (DRIVER / CONDUCTOR) raise an SOS from the mobile app; the backend
 * records it with its own server clock and broadcasts it over the self-hosted
 * Socket.IO gateway so the school admin sees it immediately. No paid third
 * party is involved anywhere in the flow: delivery is first-party
 * (database + Socket.IO + in-app), never SMS / WhatsApp / push vendor.
 */

/** Reason a crew member raises an emergency. */
export enum EmergencyType {
  ACCIDENT = 'ACCIDENT',
  BREAKDOWN = 'BREAKDOWN',
  MEDICAL = 'MEDICAL',
  STUDENT_INCIDENT = 'STUDENT_INCIDENT',
  SECURITY = 'SECURITY',
  OTHER = 'OTHER',
}

export const EMERGENCY_TYPE_VALUES: EmergencyType[] = Object.values(EmergencyType);

export const EMERGENCY_TYPE_LABELS: Record<EmergencyType, string> = {
  [EmergencyType.ACCIDENT]: 'Accident',
  [EmergencyType.BREAKDOWN]: 'Breakdown',
  [EmergencyType.MEDICAL]: 'Medical emergency',
  [EmergencyType.STUDENT_INCIDENT]: 'Student incident',
  [EmergencyType.SECURITY]: 'Security incident',
  [EmergencyType.OTHER]: 'Other',
};

/**
 * Lifecycle of an emergency event.
 *
 * OPEN        → raised by the crew, nobody at school has reacted yet
 * ACKNOWLEDGED→ the school admin has seen it and is handling it
 * RESOLVED    → handled and closed (terminal)
 * CANCELLED   → raised by mistake / false alarm (terminal)
 */
export enum EmergencyStatus {
  OPEN = 'OPEN',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  RESOLVED = 'RESOLVED',
  CANCELLED = 'CANCELLED',
}

export const EMERGENCY_STATUS_VALUES: EmergencyStatus[] = Object.values(EmergencyStatus);

export const EMERGENCY_STATUS_LABELS: Record<EmergencyStatus, string> = {
  [EmergencyStatus.OPEN]: 'Open',
  [EmergencyStatus.ACKNOWLEDGED]: 'Acknowledged',
  [EmergencyStatus.RESOLVED]: 'Resolved',
  [EmergencyStatus.CANCELLED]: 'Cancelled',
};

/** Statuses that still need the school's attention. */
export const OPEN_EMERGENCY_STATUS_VALUES: EmergencyStatus[] = [
  EmergencyStatus.OPEN,
  EmergencyStatus.ACKNOWLEDGED,
];

/** Terminal statuses — history only. */
export const TERMINAL_EMERGENCY_STATUS_VALUES: EmergencyStatus[] = [
  EmergencyStatus.RESOLVED,
  EmergencyStatus.CANCELLED,
];

/** Legal lifecycle transitions, mirrored by the service layer. */
export const EMERGENCY_STATUS_TRANSITIONS: Readonly<
  Record<EmergencyStatus, readonly EmergencyStatus[]>
> = Object.freeze({
  [EmergencyStatus.OPEN]: [EmergencyStatus.ACKNOWLEDGED, EmergencyStatus.RESOLVED, EmergencyStatus.CANCELLED],
  [EmergencyStatus.ACKNOWLEDGED]: [EmergencyStatus.RESOLVED, EmergencyStatus.CANCELLED],
  [EmergencyStatus.RESOLVED]: [],
  [EmergencyStatus.CANCELLED]: [],
});

/** True when `to` is a legal next state for an event currently in `from`. */
export const isEmergencyStatusTransitionAllowed = (
  from: EmergencyStatus,
  to: EmergencyStatus,
): boolean => EMERGENCY_STATUS_TRANSITIONS[from].includes(to);

/**
 * Body of `POST /api/v1/emergencies/sos` (crew only).
 *
 * Coordinates are optional: an SOS must always be possible, even without a
 * GPS fix, and they are never invented — the server stores exactly what the
 * device reported or `null`. The event time is the *server* clock.
 */
export interface EmergencySosRequest {
  /** Trip the emergency belongs to; defaults to the crew's active trip. */
  trip_id?: string | null;
  type: EmergencyType;
  message?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Device-reported horizontal accuracy in metres. */
  accuracy?: number | null;
}

/** Body of `PATCH /api/v1/emergencies/:id/status` (school admin / owner). */
export interface EmergencyStatusUpdateRequest {
  status: EmergencyStatus;
  /** Optional audit note recorded with the transition. */
  note?: string | null;
}

/** Public projection of one emergency event. */
export interface EmergencyEventResponse {
  id: string;
  school_id: string;
  trip_id: string | null;
  bus_id: string | null;
  route_id: string | null;
  raised_by_user_id: string;
  raised_by_name: string | null;
  raised_by_role: 'DRIVER' | 'CONDUCTOR' | null;
  type: EmergencyType;
  type_label: string;
  status: EmergencyStatus;
  status_label: string;
  message: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  /** Server time the SOS was received. */
  triggered_at: string;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
  // --- Human-readable display fields (populated by the API) ---
  bus_registration_number?: string | null;
  route_name?: string | null;
}

/** Successful payload of `GET /api/v1/emergencies`. */
export interface EmergencyEventListResponse {
  items: EmergencyEventResponse[];
  meta: PaginationMeta;
}

/** Successful payload of the active-emergencies endpoints. */
export interface EmergencyActiveListResponse {
  items: EmergencyEventResponse[];
}

/** Query string of `GET /api/v1/emergencies`. */
export interface EmergencyListQuery {
  page?: number;
  limit?: number;
  status?: EmergencyStatus;
  type?: EmergencyType;
  trip_id?: string;
  bus_id?: string;
  /** Inclusive range on `triggered_at`, `YYYY-MM-DD`. */
  date_from?: string;
  date_to?: string;
}

/** Socket.IO namespace carrying emergency broadcasts. */
export const EMERGENCIES_NAMESPACE = '/emergencies';

/** Socket.IO event names of the emergencies namespace. */
export const EMERGENCY_EVENTS = {
  /** Server → school room: a crew member raised a new SOS. */
  new: 'emergency:new',
  /** Server → school room: an existing event changed status. */
  updated: 'emergency:updated',
} as const;

export type EmergencySocketEvent =
  (typeof EMERGENCY_EVENTS)[keyof typeof EMERGENCY_EVENTS];

/**
 * Server-owned room name of one tenant's emergency feed.
 *
 * Sockets are placed in it by the gateway from the verified JWT tenant —
 * a client can never name or join another school's room.
 */
export const emergencyRoomName = (schoolId: string): string =>
  `emergency:school:${schoolId}`;
