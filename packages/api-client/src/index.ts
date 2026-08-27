import {
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
} from '@school-bus-tracking/shared-types';

export interface ApiClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  tenantId?: string;
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

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(config.tenantId ? { 'X-Tenant-ID': config.tenantId } : {}),
      ...(config.defaultHeaders || {}),
    };
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = {
      ...this.defaultHeaders,
      ...(options.headers || {}),
    };

    try {
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers,
      });

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
    return this.post<LoginResponse>('/auth/login', body);
  }

  public async refresh(): Promise<ApiResponse<RefreshResponse>> {
    return this.post<RefreshResponse>('/auth/refresh');
  }

  public async logout(): Promise<ApiResponse<LogoutResponse>> {
    return this.post<LogoutResponse>('/auth/logout');
  }

  public async onboardSchool(
    body: SchoolOnboardingRequest,
  ): Promise<ApiResponse<SchoolOnboardingResponse>> {
    return this.post<SchoolOnboardingResponse>('/schools', body);
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
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  return new ApiClient(config);
};
