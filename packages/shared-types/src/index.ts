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
 * Body of `POST /api/v1/auth/login`. Login is tenant-scoped: the same email
 * may exist under multiple schools, so the school id is always required.
 */
export interface LoginRequest {
  school_id: string;
  email: string;
  password: string;
}

/**
 * Claims carried by an access token issued by the API.
 * `sub` is the user id; `school_id` scopes every claim to a tenant.
 */
export interface JwtAccessTokenPayload {
  sub: string;
  school_id: string;
  role: UserRole;
}

/**
 * Public projection of an authenticated user. Never contains credentials
 * (`password` / `password_hash` must not appear in any API response).
 */
export interface AuthenticatedUser {
  id: string;
  school_id: string;
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
