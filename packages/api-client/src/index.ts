import {
  ApiResponse,
  HealthResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  RefreshResponse,
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

  public async login(body: LoginRequest): Promise<ApiResponse<LoginResponse>> {
    return this.post<LoginResponse>('/auth/login', body);
  }

  public async refresh(): Promise<ApiResponse<RefreshResponse>> {
    return this.post<RefreshResponse>('/auth/refresh');
  }

  public async logout(): Promise<ApiResponse<LogoutResponse>> {
    return this.post<LogoutResponse>('/auth/logout');
  }
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  return new ApiClient(config);
};
