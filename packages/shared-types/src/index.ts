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
