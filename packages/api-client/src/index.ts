import {
  AdminDashboardResponse,
  AdminSchoolAdminCreateRequest,
  AdminSchoolAdminListResponse,
  AdminSchoolAdminResetPasswordRequest,
  AdminSchoolAdminResponse,
  AdminSchoolAdminUpdateRequest,
  AdminSchoolCreateRequest,
  AdminSchoolDetailsResponse,
  AdminSchoolLifecycleResponse,
  AdminSchoolListQuery,
  AdminSchoolListResponse,
  AdminSchoolResponse,
  AdminSchoolUpdateRequest,
  ApiResponse,
  ConductorCreateRequest,
  ConductorDeleteResponse,
  ConductorListQuery,
  ConductorListResponse,
  ConductorResponse,
  ConductorUpdateRequest,
  DriverCreateRequest,
  DriverDeleteResponse,
  DriverListQuery,
  DriverListResponse,
  DriverResponse,
  DriverUpdateRequest,
  BusCreateRequest,
  BusDeleteResponse,
  BusListQuery,
  BusListResponse,
  BusResponse,
  BusUpdateRequest,
  RouteAssignmentCreateRequest,
  RouteAssignmentDeleteResponse,
  RouteAssignmentListQuery,
  RouteAssignmentListResponse,
  RouteAssignmentResponse,
  RouteAssignmentUpdateRequest,
  HealthResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  ParentCreateRequest,
  ParentDeleteResponse,
  ParentListQuery,
  ParentListResponse,
  ParentResponse,
  ParentStudentRelationshipCreateRequest,
  ParentUpdateRequest,
  ParentStudentRelationshipUpdateRequest,
  RefreshResponse,
  RouteCreateRequest,
  RouteDeleteResponse,
  RouteListQuery,
  RouteListResponse,
  RouteResponse,
  RouteStopsListResponse,
  RouteStopsOrderRequest,
  RouteUpdateRequest,
  SchoolOnboardingRequest,
  SchoolOnboardingResponse,
  StopCreateRequest,
  StopDeleteResponse,
  StopListQuery,
  StopListResponse,
  StopResponse,
  StopUpdateRequest,
  StudentCreateRequest,
  StudentDeleteResponse,
  StudentGuardianCreateRequest,
  StudentGuardianDeleteResponse,
  StudentGuardianListResponse,
  StudentGuardianResponse,
  StudentGuardianUpdateRequest,
  StudentListResponse,
  StudentResponse,
  StudentUpdateRequest,
  TripCancelRequest,
  TripCreateRequest,
  TripDeleteResponse,
  TripListQuery,
  TripListResponse,
  TripResponse,
  TripLocationHistoryQuery,
  TripLocationHistoryResponse,
  TripLocationLatestResponse,
  TripStatusUpdateRequest,
  TripStudentAttendanceResponse,
  TripStudentManifestQuery,
  TripStudentManifestResponse,
  TripUpdateRequest,
} from '@school-bus-tracking/shared-types';

export interface ApiClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  tenantId?: string;
  /**
   * In-memory access-token accessor. The client never writes tokens to
   * localStorage or the DOM — callers keep the JWT in process memory and
   * supply it here so REST calls can attach `Authorization: Bearer`.
   */
  getAccessToken?: () => string | null;
  /** Called after a successful `/auth/refresh` so the in-memory token can rotate. */
  setAccessToken?: (token: string | null) => void;
  /** Called when refresh fails so the UI can return to the login screen. */
  onUnauthorized?: () => void;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.details = details;
  }
}

const AUTH_SKIP_PATHS = new Set(['/auth/login', '/auth/refresh', '/auth/logout']);

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly getAccessToken?: () => string | null;
  private readonly setAccessToken?: (token: string | null) => void;
  private readonly onUnauthorized?: () => void;
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.tenantId ? { 'X-Tenant-ID': config.tenantId } : {}),
      ...(config.defaultHeaders || {}),
    };
    this.getAccessToken = config.getAccessToken;
    this.setAccessToken = config.setAccessToken;
    this.onUnauthorized = config.onUnauthorized;
  }

  private isAuthSkipPath(endpoint: string): boolean {
    const path = endpoint.split('?')[0];
    return AUTH_SKIP_PATHS.has(path);
  }

  private mergeHeaders(extra?: RequestInit['headers']): Record<string, string> {
    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (!extra) {
      return headers;
    }
    if (Array.isArray(extra)) {
      for (const [key, value] of extra) {
        headers[key] = value;
      }
      return headers;
    }
    if (typeof extra === 'object' && 'forEach' in extra && typeof extra.forEach === 'function') {
      extra.forEach((value: string, key: string) => {
        headers[key] = value;
      });
      return headers;
    }
    Object.assign(headers, extra);
    return headers;
  }

  private async refreshSession(): Promise<boolean> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = (async () => {
      try {
        const envelope = await this.request<ApiResponse<RefreshResponse>>(
          '/auth/refresh',
          { method: 'POST' },
          true,
        );
        const token = envelope.data?.access_token ?? null;
        if (!token) {
          this.setAccessToken?.(null);
          return false;
        }
        this.setAccessToken?.(token);
        return true;
      } catch {
        this.setAccessToken?.(null);
        return false;
      }
    })().finally(() => {
      this.refreshInFlight = null;
    });

    return this.refreshInFlight;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    skipRefresh = false,
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = this.mergeHeaders(options.headers);
    const skipAuth = this.isAuthSkipPath(endpoint);

    if (!skipAuth && !headers.Authorization && !headers.authorization) {
      const token = this.getAccessToken?.();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers,
      });

      if (response.status === 401 && !skipRefresh && !skipAuth) {
        const refreshed = await this.refreshSession();
        if (refreshed) {
          return this.request<T>(endpoint, options, true);
        }
        this.onUnauthorized?.();
      }

      if (!response.ok) {
        let errorData: unknown;
        try {
          errorData = await response.json();
        } catch {
          errorData = await response.text();
        }
        throw new ApiClientError(
          `Request failed with status ${response.status}`,
          response.status,
          errorData,
        );
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        error instanceof Error ? error.message : 'Unknown network error',
        0,
        error,
      );
    }
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  public async get<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>(endpoint, { ...options, method: 'GET' });
  }

  public async post<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>(endpoint, {
      ...options,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public async patch<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>(endpoint, {
      ...options,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public async put<T>(
    endpoint: string,
    body?: unknown,
    options?: RequestInit,
  ): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>(endpoint, {
      ...options,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  public async delete<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<ApiResponse<T>>(endpoint, { ...options, method: 'DELETE' });
  }

  public async login(body: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    const envelope = await this.post<LoginResponse>('/auth/login', body);
    if (envelope.data?.access_token) {
      this.setAccessToken?.(envelope.data.access_token);
    }
    return envelope;
  }

  public async refresh(): Promise<ApiResponse<RefreshResponse>> {
    const envelope = await this.post<RefreshResponse>('/auth/refresh');
    if (envelope.data?.access_token) {
      this.setAccessToken?.(envelope.data.access_token);
    }
    return envelope;
  }

  public async logout(): Promise<ApiResponse<LogoutResponse>> {
    try {
      return await this.post<LogoutResponse>('/auth/logout');
    } finally {
      this.setAccessToken?.(null);
    }
  }

  public async onboardSchool(
    body: SchoolOnboardingRequest,
  ): Promise<ApiResponse<SchoolOnboardingResponse>> {
    return this.post<SchoolOnboardingResponse>('/schools', body);
  }

  /**
   * Super Admin platform console (`/admin/*`).
   *
   * Every method here requires a SUPER_ADMIN access token; the API rejects
   * anonymous callers with 401 and school users with 403. The managed school
   * id is always passed explicitly in the path — it is never taken from the
   * caller's own session because a platform admin acts across tenants.
   */

  /** Platform dashboard: aggregate school/user/transport metrics. */
  public async getAdminDashboard(): Promise<ApiResponse<AdminDashboardResponse>> {
    return this.get<AdminDashboardResponse>('/admin/dashboard');
  }

  public async createAdminSchool(
    body: AdminSchoolCreateRequest,
  ): Promise<ApiResponse<AdminSchoolDetailsResponse>> {
    return this.post<AdminSchoolDetailsResponse>('/admin/schools', body);
  }

  public async listAdminSchools(
    query: AdminSchoolListQuery = {},
  ): Promise<ApiResponse<AdminSchoolListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.sort) params.set('sort', query.sort);
    if (query.order) params.set('order', query.order);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<AdminSchoolListResponse>(`/admin/schools${suffix}`);
  }

  public async getAdminSchool(id: string): Promise<ApiResponse<AdminSchoolDetailsResponse>> {
    return this.get<AdminSchoolDetailsResponse>(`/admin/schools/${encodeURIComponent(id)}`);
  }

  public async updateAdminSchool(
    id: string,
    body: AdminSchoolUpdateRequest,
  ): Promise<ApiResponse<AdminSchoolResponse>> {
    return this.patch<AdminSchoolResponse>(`/admin/schools/${encodeURIComponent(id)}`, body);
  }

  public async activateAdminSchool(id: string): Promise<ApiResponse<AdminSchoolLifecycleResponse>> {
    return this.post<AdminSchoolLifecycleResponse>(
      `/admin/schools/${encodeURIComponent(id)}/activate`,
    );
  }

  public async deactivateAdminSchool(
    id: string,
  ): Promise<ApiResponse<AdminSchoolLifecycleResponse>> {
    return this.post<AdminSchoolLifecycleResponse>(
      `/admin/schools/${encodeURIComponent(id)}/deactivate`,
    );
  }

  public async listSchoolAdmins(
    schoolId: string,
    query: { page?: number; limit?: number; search?: string } = {},
  ): Promise<ApiResponse<AdminSchoolAdminListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<AdminSchoolAdminListResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/admins${suffix}`,
    );
  }

  public async createSchoolAdmin(
    schoolId: string,
    body: AdminSchoolAdminCreateRequest,
  ): Promise<ApiResponse<AdminSchoolAdminResponse>> {
    return this.post<AdminSchoolAdminResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/admins`,
      body,
    );
  }

  public async updateSchoolAdmin(
    schoolId: string,
    adminId: string,
    body: AdminSchoolAdminUpdateRequest,
  ): Promise<ApiResponse<AdminSchoolAdminResponse>> {
    return this.patch<AdminSchoolAdminResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/admins/${encodeURIComponent(adminId)}`,
      body,
    );
  }

  public async setSchoolAdminActive(
    schoolId: string,
    adminId: string,
    isActive: boolean,
  ): Promise<ApiResponse<AdminSchoolAdminResponse>> {
    const action = isActive ? 'activate' : 'deactivate';
    return this.post<AdminSchoolAdminResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/admins/${encodeURIComponent(adminId)}/${action}`,
    );
  }

  public async resetSchoolAdminPassword(
    schoolId: string,
    adminId: string,
    body: AdminSchoolAdminResetPasswordRequest,
  ): Promise<ApiResponse<{ id: string; message: string }>> {
    return this.post<{ id: string; message: string }>(
      `/admin/schools/${encodeURIComponent(schoolId)}/admins/${encodeURIComponent(adminId)}/reset-password`,
      body,
    );
  }

  public async createStudent(body: StudentCreateRequest): Promise<ApiResponse<StudentResponse>> {
    return this.post<StudentResponse>('/students', body);
  }

  public async listStudents(
    query: { page?: number; limit?: number; search?: string } = {},
  ): Promise<ApiResponse<StudentListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<StudentListResponse>(`/students${suffix}`);
  }

  public async getStudent(id: string): Promise<ApiResponse<StudentResponse>> {
    return this.get<StudentResponse>(`/students/${encodeURIComponent(id)}`);
  }

  public async updateStudent(
    id: string,
    body: StudentUpdateRequest,
  ): Promise<ApiResponse<StudentResponse>> {
    return this.patch<StudentResponse>(`/students/${encodeURIComponent(id)}`, body);
  }

  public async deleteStudent(id: string): Promise<ApiResponse<StudentDeleteResponse>> {
    return this.delete<StudentDeleteResponse>(`/students/${encodeURIComponent(id)}`);
  }

  /** School-admin parent account management. The API derives school_id from
   * the bearer token; these methods do not accept a client tenant id. */
  public async createParent(body: ParentCreateRequest): Promise<ApiResponse<ParentResponse>> {
    return this.post<ParentResponse>('/parents', body);
  }

  public async listParents(query: ParentListQuery = {}): Promise<ApiResponse<ParentListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<ParentListResponse>(`/parents${suffix}`);
  }

  public async getParent(id: string): Promise<ApiResponse<ParentResponse>> {
    return this.get<ParentResponse>(`/parents/${encodeURIComponent(id)}`);
  }

  public async updateParent(
    id: string,
    body: ParentUpdateRequest,
  ): Promise<ApiResponse<ParentResponse>> {
    return this.patch<ParentResponse>(`/parents/${encodeURIComponent(id)}`, body);
  }

  public async deleteParent(id: string): Promise<ApiResponse<ParentDeleteResponse>> {
    return this.delete<ParentDeleteResponse>(`/parents/${encodeURIComponent(id)}`);
  }

  /** Parent-centred relationship management. */
  public async linkParentToStudent(
    parentId: string,
    body: ParentStudentRelationshipCreateRequest,
  ): Promise<ApiResponse<StudentGuardianResponse>> {
    return this.post<StudentGuardianResponse>(
      `/parents/${encodeURIComponent(parentId)}/students`,
      body,
    );
  }

  public async listParentStudents(
    parentId: string,
  ): Promise<ApiResponse<StudentGuardianListResponse>> {
    return this.get<StudentGuardianListResponse>(
      `/parents/${encodeURIComponent(parentId)}/students`,
    );
  }

  public async updateParentStudentRelationship(
    parentId: string,
    studentId: string,
    body: ParentStudentRelationshipUpdateRequest,
  ): Promise<ApiResponse<StudentGuardianResponse>> {
    return this.patch<StudentGuardianResponse>(
      `/parents/${encodeURIComponent(parentId)}/students/${encodeURIComponent(studentId)}`,
      body,
    );
  }

  public async unlinkParentFromStudent(
    parentId: string,
    studentId: string,
  ): Promise<ApiResponse<StudentGuardianDeleteResponse>> {
    return this.delete<StudentGuardianDeleteResponse>(
      `/parents/${encodeURIComponent(parentId)}/students/${encodeURIComponent(studentId)}`,
    );
  }

  /** Student-centred aliases for admin screens that start from a roster. */
  public async createStudentGuardian(
    studentId: string,
    body: StudentGuardianCreateRequest,
  ): Promise<ApiResponse<StudentGuardianResponse>> {
    return this.post<StudentGuardianResponse>(
      `/students/${encodeURIComponent(studentId)}/guardians`,
      body,
    );
  }

  public async listStudentGuardians(
    studentId: string,
  ): Promise<ApiResponse<StudentGuardianListResponse>> {
    return this.get<StudentGuardianListResponse>(
      `/students/${encodeURIComponent(studentId)}/guardians`,
    );
  }

  public async updateStudentGuardian(
    studentId: string,
    parentId: string,
    body: StudentGuardianUpdateRequest,
  ): Promise<ApiResponse<StudentGuardianResponse>> {
    return this.patch<StudentGuardianResponse>(
      `/students/${encodeURIComponent(studentId)}/guardians/${encodeURIComponent(parentId)}`,
      body,
    );
  }

  public async deleteStudentGuardian(
    studentId: string,
    parentId: string,
  ): Promise<ApiResponse<StudentGuardianDeleteResponse>> {
    return this.delete<StudentGuardianDeleteResponse>(
      `/students/${encodeURIComponent(studentId)}/guardians/${encodeURIComponent(parentId)}`,
    );
  }

  /** A parent can read only the relationships belonging to their JWT subject. */
  public async listMyStudents(): Promise<ApiResponse<StudentGuardianListResponse>> {
    return this.get<StudentGuardianListResponse>('/parents/me/students');
  }

  /**
   * Fleet, route and stop management. The API derives school_id exclusively
   * from the bearer token — these methods never accept a client tenant id.
   */
  public async createBus(body: BusCreateRequest): Promise<ApiResponse<BusResponse>> {
    return this.post<BusResponse>('/buses', body);
  }

  public async listBuses(query: BusListQuery = {}): Promise<ApiResponse<BusListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<BusListResponse>(`/buses${suffix}`);
  }

  public async getBus(id: string): Promise<ApiResponse<BusResponse>> {
    return this.get<BusResponse>(`/buses/${encodeURIComponent(id)}`);
  }

  public async updateBus(id: string, body: BusUpdateRequest): Promise<ApiResponse<BusResponse>> {
    return this.patch<BusResponse>(`/buses/${encodeURIComponent(id)}`, body);
  }

  public async deleteBus(id: string): Promise<ApiResponse<BusDeleteResponse>> {
    return this.delete<BusDeleteResponse>(`/buses/${encodeURIComponent(id)}`);
  }

  public async createRoute(body: RouteCreateRequest): Promise<ApiResponse<RouteResponse>> {
    return this.post<RouteResponse>('/routes', body);
  }

  public async listRoutes(query: RouteListQuery = {}): Promise<ApiResponse<RouteListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<RouteListResponse>(`/routes${suffix}`);
  }

  public async getRoute(id: string): Promise<ApiResponse<RouteResponse>> {
    return this.get<RouteResponse>(`/routes/${encodeURIComponent(id)}`);
  }

  public async updateRoute(
    id: string,
    body: RouteUpdateRequest,
  ): Promise<ApiResponse<RouteResponse>> {
    return this.patch<RouteResponse>(`/routes/${encodeURIComponent(id)}`, body);
  }

  public async deleteRoute(id: string): Promise<ApiResponse<RouteDeleteResponse>> {
    return this.delete<RouteDeleteResponse>(`/routes/${encodeURIComponent(id)}`);
  }

  /** Ordered stop manifest of a route (ascending sequence_number). */
  public async listRouteStops(id: string): Promise<ApiResponse<RouteStopsListResponse>> {
    return this.get<RouteStopsListResponse>(`/routes/${encodeURIComponent(id)}/stops`);
  }

  /** Renumbers the route's stops 1..N in the given order. */
  public async reorderRouteStops(
    id: string,
    body: RouteStopsOrderRequest,
  ): Promise<ApiResponse<RouteStopsListResponse>> {
    return this.put<RouteStopsListResponse>(`/routes/${encodeURIComponent(id)}/stops`, body);
  }

  public async createStop(body: StopCreateRequest): Promise<ApiResponse<StopResponse>> {
    return this.post<StopResponse>('/stops', body);
  }

  public async listStops(query: StopListQuery = {}): Promise<ApiResponse<StopListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    if (query.route_id) params.set('route_id', query.route_id);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<StopListResponse>(`/stops${suffix}`);
  }

  public async getStop(id: string): Promise<ApiResponse<StopResponse>> {
    return this.get<StopResponse>(`/stops/${encodeURIComponent(id)}`);
  }

  public async updateStop(id: string, body: StopUpdateRequest): Promise<ApiResponse<StopResponse>> {
    return this.patch<StopResponse>(`/stops/${encodeURIComponent(id)}`, body);
  }

  public async deleteStop(id: string): Promise<ApiResponse<StopDeleteResponse>> {
    return this.delete<StopDeleteResponse>(`/stops/${encodeURIComponent(id)}`);
  }

  /**
   * Driver & conductor staff management. The API derives school_id from the
   * bearer token and pins the role per resource, so these methods never
   * accept a client tenant id or role.
   */
  public async createDriver(body: DriverCreateRequest): Promise<ApiResponse<DriverResponse>> {
    return this.post<DriverResponse>('/drivers', body);
  }

  public async listDrivers(query: DriverListQuery = {}): Promise<ApiResponse<DriverListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<DriverListResponse>(`/drivers${suffix}`);
  }

  public async getDriver(id: string): Promise<ApiResponse<DriverResponse>> {
    return this.get<DriverResponse>(`/drivers/${encodeURIComponent(id)}`);
  }

  public async updateDriver(
    id: string,
    body: DriverUpdateRequest,
  ): Promise<ApiResponse<DriverResponse>> {
    return this.patch<DriverResponse>(`/drivers/${encodeURIComponent(id)}`, body);
  }

  public async deleteDriver(id: string): Promise<ApiResponse<DriverDeleteResponse>> {
    return this.delete<DriverDeleteResponse>(`/drivers/${encodeURIComponent(id)}`);
  }

  public async createConductor(
    body: ConductorCreateRequest,
  ): Promise<ApiResponse<ConductorResponse>> {
    return this.post<ConductorResponse>('/conductors', body);
  }

  public async listConductors(
    query: ConductorListQuery = {},
  ): Promise<ApiResponse<ConductorListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<ConductorListResponse>(`/conductors${suffix}`);
  }

  public async getConductor(id: string): Promise<ApiResponse<ConductorResponse>> {
    return this.get<ConductorResponse>(`/conductors/${encodeURIComponent(id)}`);
  }

  public async updateConductor(
    id: string,
    body: ConductorUpdateRequest,
  ): Promise<ApiResponse<ConductorResponse>> {
    return this.patch<ConductorResponse>(`/conductors/${encodeURIComponent(id)}`, body);
  }

  public async deleteConductor(id: string): Promise<ApiResponse<ConductorDeleteResponse>> {
    return this.delete<ConductorDeleteResponse>(`/conductors/${encodeURIComponent(id)}`);
  }

  /**
   * Bus, route and crew assignment management. Each RouteAssignment row
   * represents one DRIVER or CONDUCTOR on a route/bus for an effective period.
   * The API derives school_id from the bearer token; these methods never accept
   * a client tenant id.
   */
  public async createRouteAssignment(
    body: RouteAssignmentCreateRequest,
  ): Promise<ApiResponse<RouteAssignmentResponse>> {
    return this.post<RouteAssignmentResponse>('/route-assignments', body);
  }

  public async listRouteAssignments(
    query: RouteAssignmentListQuery = {},
  ): Promise<ApiResponse<RouteAssignmentListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.route_id) params.set('route_id', query.route_id);
    if (query.bus_id) params.set('bus_id', query.bus_id);
    if (query.user_id) params.set('user_id', query.user_id);
    if (query.role) params.set('role', query.role);
    if (query.is_active !== undefined) params.set('is_active', String(query.is_active));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<RouteAssignmentListResponse>(`/route-assignments${suffix}`);
  }

  public async getRouteAssignment(id: string): Promise<ApiResponse<RouteAssignmentResponse>> {
    return this.get<RouteAssignmentResponse>(`/route-assignments/${encodeURIComponent(id)}`);
  }

  public async updateRouteAssignment(
    id: string,
    body: RouteAssignmentUpdateRequest,
  ): Promise<ApiResponse<RouteAssignmentResponse>> {
    return this.patch<RouteAssignmentResponse>(
      `/route-assignments/${encodeURIComponent(id)}`,
      body,
    );
  }

  public async deleteRouteAssignment(
    id: string,
  ): Promise<ApiResponse<RouteAssignmentDeleteResponse>> {
    return this.delete<RouteAssignmentDeleteResponse>(
      `/route-assignments/${encodeURIComponent(id)}`,
    );
  }

  /** Short aliases for screens that call the resource simply "assignments". */
  public async createAssignment(
    body: RouteAssignmentCreateRequest,
  ): Promise<ApiResponse<RouteAssignmentResponse>> {
    return this.post<RouteAssignmentResponse>('/assignments', body);
  }

  public async listAssignments(
    query: RouteAssignmentListQuery = {},
  ): Promise<ApiResponse<RouteAssignmentListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.route_id) params.set('route_id', query.route_id);
    if (query.bus_id) params.set('bus_id', query.bus_id);
    if (query.user_id) params.set('user_id', query.user_id);
    if (query.role) params.set('role', query.role);
    if (query.is_active !== undefined) params.set('is_active', String(query.is_active));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<RouteAssignmentListResponse>(`/assignments${suffix}`);
  }

  public async getAssignment(id: string): Promise<ApiResponse<RouteAssignmentResponse>> {
    return this.get<RouteAssignmentResponse>(`/assignments/${encodeURIComponent(id)}`);
  }

  public async updateAssignment(
    id: string,
    body: RouteAssignmentUpdateRequest,
  ): Promise<ApiResponse<RouteAssignmentResponse>> {
    return this.patch<RouteAssignmentResponse>(`/assignments/${encodeURIComponent(id)}`, body);
  }

  public async deleteAssignment(id: string): Promise<ApiResponse<RouteAssignmentDeleteResponse>> {
    return this.delete<RouteAssignmentDeleteResponse>(`/assignments/${encodeURIComponent(id)}`);
  }

  /**
   * Trip management. A trip is dispatched from an active route assignment and
   * the API derives school, route, bus, driver and conductor from it, so these
   * methods never send a tenant id or crew ids.
   */
  public async createTrip(body: TripCreateRequest): Promise<ApiResponse<TripResponse>> {
    return this.post<TripResponse>('/trips', body);
  }

  public async listTrips(query: TripListQuery = {}): Promise<ApiResponse<TripListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.status) params.set('status', query.status);
    if (query.route_id) params.set('route_id', query.route_id);
    if (query.bus_id) params.set('bus_id', query.bus_id);
    if (query.driver_id) params.set('driver_id', query.driver_id);
    if (query.conductor_id) params.set('conductor_id', query.conductor_id);
    if (query.date) params.set('date', query.date);
    if (query.date_from) params.set('date_from', query.date_from);
    if (query.date_to) params.set('date_to', query.date_to);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<TripListResponse>(`/trips${suffix}`);
  }

  public async getTrip(id: string): Promise<ApiResponse<TripResponse>> {
    return this.get<TripResponse>(`/trips/${encodeURIComponent(id)}`);
  }

  public async updateTrip(id: string, body: TripUpdateRequest): Promise<ApiResponse<TripResponse>> {
    return this.patch<TripResponse>(`/trips/${encodeURIComponent(id)}`, body);
  }

  /** Applies a single lifecycle transition (SCHEDULED → IN_PROGRESS → COMPLETED). */
  public async updateTripStatus(
    id: string,
    body: TripStatusUpdateRequest,
  ): Promise<ApiResponse<TripResponse>> {
    return this.patch<TripResponse>(`/trips/${encodeURIComponent(id)}/status`, body);
  }

  /** Cancels a non-terminal trip while keeping it visible in reporting. */
  public async cancelTrip(
    id: string,
    body: TripCancelRequest = {},
  ): Promise<ApiResponse<TripResponse>> {
    return this.post<TripResponse>(`/trips/${encodeURIComponent(id)}/cancel`, body);
  }

  /** Cancels (when still open) and soft-deletes the trip. */
  public async deleteTrip(id: string): Promise<ApiResponse<TripDeleteResponse>> {
    return this.delete<TripDeleteResponse>(`/trips/${encodeURIComponent(id)}`);
  }

  /**
   * Live GPS tracking. The API resolves the trip inside the caller's tenant
   * and authorizes the caller for it (admin, rostered crew or the parent of
   * a student on the trip), so these methods never send a tenant id, a crew
   * id or a timestamp. Live updates themselves travel over the
   * `/live-tracking` Socket.IO namespace, not over REST.
   */

  /** Latest known position of the trip's bus. `404` until the first fix lands. */
  public async getTripLocation(tripId: string): Promise<ApiResponse<TripLocationLatestResponse>> {
    return this.get<TripLocationLatestResponse>(`/trips/${encodeURIComponent(tripId)}/location`);
  }

  /**
   * Chronological location history of the trip, bounded by an optional
   * `recorded_at` window and always by `limit` (1..500, default 100).
   */
  public async getTripLocationHistory(
    tripId: string,
    query: TripLocationHistoryQuery = {},
  ): Promise<ApiResponse<TripLocationHistoryResponse>> {
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<TripLocationHistoryResponse>(
      `/trips/${encodeURIComponent(tripId)}/location/history${suffix}`,
    );
  }

  /**
   * Trip student attendance. The manifest is derived server-side from the
   * trip's route and stops, and boarding/drop events are timestamped by the
   * server, so these methods never send a tenant id, a stop id or a
   * timestamp — the board/drop calls deliberately carry no body at all.
   */
  public async listTripStudents(
    tripId: string,
    query: TripStudentManifestQuery = {},
  ): Promise<ApiResponse<TripStudentManifestResponse>> {
    const params = new URLSearchParams();
    if (query.status) params.set('status', query.status);
    if (query.stop_id) params.set('stop_id', query.stop_id);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return this.get<TripStudentManifestResponse>(
      `/trips/${encodeURIComponent(tripId)}/students${suffix}`,
    );
  }

  public async getTripStudent(
    tripId: string,
    studentId: string,
  ): Promise<ApiResponse<TripStudentAttendanceResponse>> {
    return this.get<TripStudentAttendanceResponse>(
      `/trips/${encodeURIComponent(tripId)}/students/${encodeURIComponent(studentId)}`,
    );
  }

  /** Marks the student as boarded; the server records who and when. */
  public async boardTripStudent(
    tripId: string,
    studentId: string,
  ): Promise<ApiResponse<TripStudentAttendanceResponse>> {
    return this.post<TripStudentAttendanceResponse>(
      `/trips/${encodeURIComponent(tripId)}/students/${encodeURIComponent(studentId)}/board`,
    );
  }

  /** Marks a previously boarded student as dropped off. */
  public async dropTripStudent(
    tripId: string,
    studentId: string,
  ): Promise<ApiResponse<TripStudentAttendanceResponse>> {
    return this.post<TripStudentAttendanceResponse>(
      `/trips/${encodeURIComponent(tripId)}/students/${encodeURIComponent(studentId)}/drop`,
    );
  }
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  return new ApiClient(config);
};
