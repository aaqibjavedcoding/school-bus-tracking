import {
  ApiResponse,
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
  SchoolOnboardingRequest,
  SchoolOnboardingResponse,
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
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  return new ApiClient(config);
};
