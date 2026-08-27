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
