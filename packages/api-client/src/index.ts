import {
  DataFileFormat,
  AdminDashboardResponse,
  AdminPlanCreateRequest,
  AdminPlanLifecycleResponse,
  AdminPlanListQuery,
  AdminPlanListResponse,
  AdminPlanResponse,
  AdminPlanUpdateRequest,
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
  AdminSchoolSubscriptionCancelRequest,
  AdminSchoolSubscriptionCreateRequest,
  AdminSchoolSubscriptionHistoryResponse,
  AdminSchoolSubscriptionResponse,
  AdminSchoolSubscriptionUpdateRequest,
  AdminSchoolUpdateRequest,
  AdminSubscriptionListQuery,
  AdminSubscriptionListResponse,
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
  NotificationReadAllResponse,
  ParentChildDetailResponse,
  ParentChildListResponse,
  ParentChildTodayResponse,
  ParentDashboardResponse,
  ParentNotificationListQuery,
  ParentNotificationListResponse,
  ParentTrackingResponse,
  RefreshResponse,
  NotificationResponse,
  DeviceTokenRegisterRequest,
  DeviceTokenResponse,
  DeviceTokenUnregisterResponse,
  RouteCreateRequest,
  RouteDeleteResponse,
  RouteDetailResponse,
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
  TripProgressResponse,
  TripStatusUpdateRequest,
  TripStopArrivalListResponse,
  TripStudentAttendanceResponse,
  TripStudentManifestQuery,
  TripStudentManifestResponse,
  TripUpdateRequest,
  TripEtaResponse,
  ExportDataset,
  ExportQuery,
  ImportCommitResponse,
  ImportJobDetailResponse,
  ImportJobListQuery,
  ImportJobListResponse,
  ImportMode,
  ImportModule,
  ImportModuleListResponse,
  ImportValidationResponse,
  ReportCatalogueResponse,
  ReportOverviewResponse,
  ReportQuery,
  ReportResultResponse,
  ReportType,
  BusDocumentCreateRequest,
  BusDocumentListResponse,
  BusDocumentResponse,
  BusDocumentUpdateRequest,
  DocumentComplianceResponse,
  DocumentDeleteResponse,
  DocumentListQuery,
  DocumentOverviewQuery,
  DocumentOverviewResponse,
  DocumentRequirementsListQuery,
  DocumentRequirementsResponse,
  DocumentRequirementsUpdateRequest,
  DriverDocumentCreateRequest,
  DriverDocumentListResponse,
  DriverDocumentResponse,
  DriverDocumentUpdateRequest,
  EmergencyActiveListResponse,
  EmergencyEventListResponse,
  EmergencyEventResponse,
  EmergencyListQuery,
  EmergencySosRequest,
  EmergencyStatus,
  EmergencyStatusUpdateRequest,
  AssistedSessionCurrentResponse,
  AssistedSessionEndResponse,
  AssistedSessionStartResponse,
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
  /**
   * Name of the readable CSRF cookie issued by the API (`csrf_token` by
   * default). Its value is echoed in the `X-CSRF-Token` header on every
   * unsafe request so cookie-authenticated browser calls pass the API's
   * double-submit check.
   */
  csrfCookieName?: string;
  /** Header the CSRF token is echoed in (`X-CSRF-Token` by default). */
  csrfHeaderName?: string;
  /**
   * Endpoint (relative to `baseUrl`) that seeds the readable CSRF cookie —
   * `GET /auth/csrf` on this API.
   */
  csrfTokenPath?: string;
  /**
   * Whether the client may bootstrap a missing CSRF token by calling
   * {@link ApiClientConfig.csrfTokenPath} before an unsafe request.
   *
   * Defaults to "browser only": a cookie jar the double-submit pattern can
   * use exists exactly where `document.cookie` does. Native clients (React
   * Native, Node) are authenticated with a bearer token and are exempted by
   * the API, so they never issue the extra request.
   */
  csrfBootstrap?: boolean;
  /** Called after a successful `/auth/refresh` so the in-memory token can rotate. */
  setAccessToken?: (token: string | null) => void;
  /** Called when refresh fails so the UI can return to the login screen. */
  onUnauthorized?: () => void;
  /**
   * Active Super Admin managed-school context ("Manage Data"), if any.
   *
   * When it returns a school id, tenant resource calls (`/students`,
   * `/imports/...`, `/reports/...`, …) are transparently remapped to the
   * guarded assisted-management endpoints
   * (`/admin/schools/:id/manage/...`) — see {@link resolveManagedSchoolPath}.
   * The server still enforces the role and the managed-school boundary on
   * every call; this mapping only points the client at the right surface.
   * Platform (`/admin/...`) and auth calls are never remapped.
   */
  resolveManagedSchoolId?: () => string | null;
}

/**
 * Tenant resources the assisted-management surface supports.
 *
 * Deliberately an allowlist: anything not listed is left untouched, so a page
 * outside the assisted scope (trips, tracking, documents, parent portal, …)
 * keeps calling its tenant endpoint and is rejected server-side by the role
 * guard rather than being silently redirected somewhere unexpected.
 */
const MANAGED_TENANT_PATH_RULES: RegExp[] = [
  /^\/students(?:\/[0-9a-fA-F-]{36})?(?:\/guardians(?:\/[0-9a-fA-F-]{36})?)?$/,
  /^\/parents(?:\/[0-9a-fA-F-]{36})?(?:\/students\/[0-9a-fA-F-]{36})?$/,
  /^\/buses(?:\/[0-9a-fA-F-]{36})?$/,
  /^\/routes(?:\/[0-9a-fA-F-]{36})?(?:\/(?:stops|details))?$/,
  /^\/stops(?:\/[0-9a-fA-F-]{36})?$/,
  /^\/(?:drivers|conductors)(?:\/[0-9a-fA-F-]{36})?$/,
  /^\/(?:route-assignments|assignments)(?:\/[0-9a-fA-F-]{36})?$/,
  /^\/imports(?:\/(?:modules|history(?:\/[0-9a-fA-F-]{36}(?:\/error-file)?)?|[a-z-]+\/(?:template|validate|commit)))?$/,
  /^\/exports(?:\/[a-z-]+)?$/,
  /^\/reports(?:\/(?:overview|[a-z0-9_]+(?:\/export)?))?$/,
];

/**
 * Remaps a tenant endpoint onto the assisted-management surface.
 *
 * Pure and exported for tests. The query string is preserved untouched; the
 * managed school id always lands in the path, exactly where the API's
 * {@linkcode ManagedSchoolGuard} expects it.
 *
 * Returns `null` when the endpoint is not a supported tenant resource — the
 * caller then sends the endpoint unchanged (and the API's role guard decides).
 */
export function resolveManagedSchoolPath(schoolId: string, endpoint: string): string | null {
  if (!schoolId || !endpoint.startsWith('/')) {
    return null;
  }
  const queryIndex = endpoint.indexOf('?');
  const path = queryIndex === -1 ? endpoint : endpoint.slice(0, queryIndex);
  const query = queryIndex === -1 ? '' : endpoint.slice(queryIndex);

  const normalised = path !== '/' && path.endsWith('/') ? path.replace(/\/+$/, '') : path;

  const matched = MANAGED_TENANT_PATH_RULES.some((rule) => rule.test(normalised));
  if (!matched) {
    return null;
  }
  return `/admin/schools/${encodeURIComponent(schoolId)}/manage${normalised}${query}`;
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

/** HTTP methods the API treats as safe (never CSRF-checked). */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Default names of the API's double-submit CSRF cookie and header. */
export const CSRF_COOKIE_NAME = 'csrf_token';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

/**
 * Endpoint that issues (or rotates) the readable double-submit CSRF cookie.
 *
 * `GET /auth/csrf` is unauthenticated and safe, so a browser can always call
 * it — including before login, which is exactly when a stale session cookie
 * would otherwise leave the app unable to obtain a token.
 */
export const CSRF_TOKEN_PATH = '/auth/csrf';

/** Payload of `GET /auth/csrf` (inside the standard `{ success, data }` envelope). */
export interface CsrfTokenPayload {
  csrf_token: string;
  header_name?: string;
}

/**
 * True when the runtime has a browser cookie jar.
 *
 * The double-submit dance only makes sense there: a browser is the only
 * client that attaches cookies ambiently, and the only one that can read the
 * non-httpOnly CSRF cookie back out to echo it in a header. React Native and
 * Node have no `document`, use bearer tokens and send no `Origin`, so the API
 * exempts them — and this client never bootstraps a token for them.
 */
export function hasBrowserCookieJar(): boolean {
  const cookieJar = (globalThis as { document?: { cookie?: string } }).document;
  return Boolean(cookieJar) && typeof cookieJar?.cookie === 'string';
}

/** True when a 403 body is the API's CSRF rejection rather than an authorization failure. */
function isCsrfRejection(errorData: unknown): boolean {
  if (typeof errorData === 'string') {
    return /csrf/i.test(errorData);
  }
  if (!errorData || typeof errorData !== 'object') {
    return false;
  }
  const envelope = errorData as { message?: unknown; error?: { message?: unknown } };
  const message = envelope.error?.message ?? envelope.message;
  return typeof message === 'string' && /csrf/i.test(message);
}

/**
 * Reads a cookie from `document.cookie`.
 *
 * The CSRF cookie is deliberately *not* httpOnly: the browser must be able to
 * echo it back in a header, which is precisely what an attacker on another
 * origin cannot do. Outside a browser (SSR, React Native, tests) there is no
 * cookie jar and this returns null — bearer-token clients are unaffected.
 */
export function readBrowserCookie(name: string): string | null {
  // Reached through `globalThis` so the package keeps building without the
  // DOM lib and stays usable from Node/React Native.
  const cookieJar = (globalThis as { document?: { cookie?: string } }).document;
  if (!cookieJar || typeof cookieJar.cookie !== 'string') {
    return null;
  }
  for (const entry of cookieJar.cookie.split(';')) {
    const separator = entry.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (entry.slice(0, separator).trim() === name) {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    }
  }
  return null;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly getAccessToken?: () => string | null;
  private readonly setAccessToken?: (token: string | null) => void;
  private readonly onUnauthorized?: () => void;
  private readonly csrfCookieName: string;
  private csrfHeaderName: string;
  /** True when the caller pinned the header name, so the API cannot override it. */
  private readonly csrfHeaderNamePinned: boolean;
  private readonly csrfTokenPath: string;
  private readonly csrfBootstrap?: boolean;
  private readonly resolveManagedSchoolId?: () => string | null;
  private refreshInFlight: Promise<boolean> | null = null;
  private csrfBootstrapInFlight: Promise<string | null> | null = null;

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
    this.csrfCookieName = config.csrfCookieName || CSRF_COOKIE_NAME;
    this.csrfHeaderName = config.csrfHeaderName || CSRF_HEADER_NAME;
    this.csrfHeaderNamePinned = Boolean(config.csrfHeaderName);
    this.csrfTokenPath = config.csrfTokenPath || CSRF_TOKEN_PATH;
    this.csrfBootstrap = config.csrfBootstrap;
    this.resolveManagedSchoolId = config.resolveManagedSchoolId;
  }

  /**
   * Endpoint to actually send: the managed-school remap happens here so every
   * verb (JSON requests and binary downloads) follows the same rule. Idempotent
   * — already-remapped `/admin/...` endpoints never match the tenant rules.
   */
  private effectiveEndpoint(endpoint: string): string {
    const managedSchoolId = this.resolveManagedSchoolId?.() ?? null;
    if (!managedSchoolId) {
      return endpoint;
    }
    return resolveManagedSchoolPath(managedSchoolId, endpoint) ?? endpoint;
  }

  /** True when this runtime is allowed to call the CSRF bootstrap endpoint. */
  private csrfBootstrapAllowed(): boolean {
    return this.csrfBootstrap ?? hasBrowserCookieJar();
  }

  /**
   * Returns a usable double-submit token, fetching one when the cookie jar
   * has none.
   *
   * The API only seeds the cookie on `POST /auth/login`, `POST /auth/refresh`
   * and `GET /auth/csrf`. A browser that still holds a refresh cookie but no
   * CSRF cookie (fresh tab after the 12h cookie TTL, a session that predates
   * the CSRF rollout, or a logout that cleared it) would otherwise be stuck:
   * every state-changing auth call — including the login that is supposed to
   * repair the session — is rejected with 403 "Invalid or missing CSRF
   * token". Bootstrapping through the safe `GET` endpoint breaks that
   * deadlock without weakening the check.
   *
   * Concurrent callers share one in-flight request; `force` re-fetches even
   * when a (stale) cookie is present.
   */
  public async ensureCsrfToken(force = false): Promise<string | null> {
    if (!force) {
      const existing = readBrowserCookie(this.csrfCookieName);
      if (existing) {
        return existing;
      }
    }
    if (!this.csrfBootstrapAllowed()) {
      return null;
    }
    if (this.csrfBootstrapInFlight) {
      return this.csrfBootstrapInFlight;
    }

    this.csrfBootstrapInFlight = this.fetchCsrfToken().finally(() => {
      this.csrfBootstrapInFlight = null;
    });

    return this.csrfBootstrapInFlight;
  }

  /**
   * Calls `GET /auth/csrf`.
   *
   * `credentials: 'include'` is what makes the browser store the returned
   * cookie; the response body carries the same value so the header can be
   * set even before the jar is readable. A failure is never fatal — the
   * request is attempted with whatever the jar holds and the API decides.
   */
  private async fetchCsrfToken(): Promise<string | null> {
    try {
      const response = await fetch(`${this.baseUrl}${this.csrfTokenPath}`, {
        method: 'GET',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        return readBrowserCookie(this.csrfCookieName);
      }
      const body = (await response.json()) as
        ApiResponse<CsrfTokenPayload> | CsrfTokenPayload | null;
      const payload = (body && 'data' in body ? body.data : body) as
        CsrfTokenPayload | null | undefined;
      if (!this.csrfHeaderNamePinned && payload?.header_name) {
        // The header name is configurable server-side (`CSRF_HEADER_NAME`);
        // adopting the advertised one keeps the client correct without a
        // second environment variable.
        this.csrfHeaderName = payload.header_name;
      }
      return payload?.csrf_token || readBrowserCookie(this.csrfCookieName);
    } catch {
      return readBrowserCookie(this.csrfCookieName);
    }
  }

  /**
   * Attaches the double-submit CSRF token to unsafe requests.
   *
   * Nothing happens when the caller already set the header, when the method
   * is safe, or when there is no token to be had (non-browser clients).
   * `allowBootstrap` is false for bearer-authenticated calls: the API exempts
   * them, so they must not pay for an extra round trip.
   */
  private async applyCsrfHeader(
    method: string,
    headers: Record<string, string>,
    allowBootstrap: boolean,
  ): Promise<void> {
    if (SAFE_METHODS.has(method.toUpperCase())) {
      return;
    }
    const alreadySet = Object.keys(headers).some(
      (key) => key.toLowerCase() === this.csrfHeaderName.toLowerCase(),
    );
    if (alreadySet) {
      return;
    }
    let token = readBrowserCookie(this.csrfCookieName);
    if (!token && allowBootstrap) {
      token = await this.ensureCsrfToken();
    }
    if (token) {
      headers[this.csrfHeaderName] = token;
    }
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
    skipCsrfRetry = false,
  ): Promise<T> {
    endpoint = this.effectiveEndpoint(endpoint);
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = this.mergeHeaders(options.headers);
    // FormData must carry the runtime-generated multipart boundary. The
    // client's default `Content-Type: application/json` would otherwise ride
    // along with the upload, Nest's JSON parser would consume
    // `------WebKitFormBoundary...`, and the Import UI would show
    // `Unexpected token '-', "------WebK"... is not valid JSON`.
    if (isFormDataBody(options.body)) {
      stripHeader(headers, 'content-type');
    }
    const skipAuth = this.isAuthSkipPath(endpoint);

    if (!skipAuth && !headers.Authorization && !headers.authorization) {
      const token = this.getAccessToken?.();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    // Bearer-authenticated calls are exempted by the API's CSRF rule (a
    // bearer token is never ambiently attached by a browser), so only
    // cookie-authenticated calls — the `/auth/*` ones — may bootstrap a token.
    const sendsBearer = Boolean(headers.Authorization || headers.authorization);
    await this.applyCsrfHeader(options.method || 'GET', headers, !sendsBearer);

    try {
      const response = await fetch(url, {
        credentials: 'include',
        ...options,
        headers,
      });

      if (response.status === 401 && !skipRefresh && !skipAuth) {
        const refreshed = await this.refreshSession();
        if (refreshed) {
          return this.request<T>(endpoint, options, true, skipCsrfRetry);
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

        // A 403 CSRF rejection means the cookie we echoed is gone or was
        // rotated (logout in another tab, expired TTL). Re-seed once and
        // replay — never more than once, so a genuinely rejected origin
        // cannot turn into a request loop.
        if (
          response.status === 403 &&
          !skipCsrfRetry &&
          isCsrfRejection(errorData) &&
          this.csrfBootstrapAllowed()
        ) {
          const token = await this.ensureCsrfToken(true);
          if (token) {
            return this.request<T>(endpoint, options, skipRefresh, true);
          }
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
    const suffix = querySuffix(params);
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
    const suffix = querySuffix(params);
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

  /**
   * Super Admin plan catalog (`/admin/plans`).
   *
   * Plans are platform-level (tenant-less) commercial tiers. These endpoints
   * require a SUPER_ADMIN access token. No payment or subscription lifecycle
   * is exposed yet — this is the catalog CRUD surface the billing phase will
   * reference when attaching plans to schools.
   */

  public async createAdminPlan(
    body: AdminPlanCreateRequest,
  ): Promise<ApiResponse<AdminPlanResponse>> {
    return this.post<AdminPlanResponse>('/admin/plans', body);
  }

  public async listAdminPlans(
    query: AdminPlanListQuery = {},
  ): Promise<ApiResponse<AdminPlanListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.sort) params.set('sort', query.sort);
    if (query.order) params.set('order', query.order);
    const suffix = querySuffix(params);
    return this.get<AdminPlanListResponse>(`/admin/plans${suffix}`);
  }

  public async getAdminPlan(id: string): Promise<ApiResponse<AdminPlanResponse>> {
    return this.get<AdminPlanResponse>(`/admin/plans/${encodeURIComponent(id)}`);
  }

  public async updateAdminPlan(
    id: string,
    body: AdminPlanUpdateRequest,
  ): Promise<ApiResponse<AdminPlanResponse>> {
    return this.patch<AdminPlanResponse>(`/admin/plans/${encodeURIComponent(id)}`, body);
  }

  public async activateAdminPlan(id: string): Promise<ApiResponse<AdminPlanLifecycleResponse>> {
    return this.post<AdminPlanLifecycleResponse>(`/admin/plans/${encodeURIComponent(id)}/activate`);
  }

  public async deactivateAdminPlan(id: string): Promise<ApiResponse<AdminPlanLifecycleResponse>> {
    return this.post<AdminPlanLifecycleResponse>(
      `/admin/plans/${encodeURIComponent(id)}/deactivate`,
    );
  }

  /**
   * Super Admin school subscriptions
   * (`/admin/schools/:schoolId/subscription`).
   *
   * Attaches a school to a plan of the catalog and manages the lifecycle
   * (trial, current period, cancellation). SUPER_ADMIN only. No payment is
   * processed by any of these calls; a school without a subscription reads
   * back as `status: 'none'` rather than an error.
   */

  public async getSchoolSubscription(
    schoolId: string,
  ): Promise<ApiResponse<AdminSchoolSubscriptionResponse>> {
    return this.get<AdminSchoolSubscriptionResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/subscription`,
    );
  }

  /**
   * Full subscription history of a school, newest first. Read-only — plan
   * changes and cancellations preserve their rows and this returns them all
   * in one response (no per-row follow-up requests).
   */
  public async getSchoolSubscriptionHistory(
    schoolId: string,
  ): Promise<ApiResponse<AdminSchoolSubscriptionHistoryResponse>> {
    return this.get<AdminSchoolSubscriptionHistoryResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/subscription/history`,
    );
  }

  public async createSchoolSubscription(
    schoolId: string,
    body: AdminSchoolSubscriptionCreateRequest,
  ): Promise<ApiResponse<AdminSchoolSubscriptionResponse>> {
    return this.post<AdminSchoolSubscriptionResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/subscription`,
      body,
    );
  }

  public async updateSchoolSubscription(
    schoolId: string,
    body: AdminSchoolSubscriptionUpdateRequest,
  ): Promise<ApiResponse<AdminSchoolSubscriptionResponse>> {
    return this.patch<AdminSchoolSubscriptionResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/subscription`,
      body,
    );
  }

  public async cancelSchoolSubscription(
    schoolId: string,
    body: AdminSchoolSubscriptionCancelRequest = {},
  ): Promise<ApiResponse<AdminSchoolSubscriptionResponse>> {
    return this.post<AdminSchoolSubscriptionResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/subscription/cancel`,
      body,
    );
  }

  /**
   * Platform-wide subscription list (`/admin/subscriptions`).
   *
   * SUPER_ADMIN only. Returns every school paired with its current/latest
   * subscription (or a clean `none` state), plan, period dates and current
   * usage. No payment or billing data is ever included.
   */
  public async listAdminSubscriptions(
    query: AdminSubscriptionListQuery = {},
  ): Promise<ApiResponse<AdminSubscriptionListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.plan_id) params.set('plan_id', query.plan_id);
    const suffix = querySuffix(params);
    return this.get<AdminSubscriptionListResponse>(`/admin/subscriptions${suffix}`);
  }

  /**
   * Assisted-management session lifecycle ("Manage Data").
   *
   * These are the only assisted endpoints that take the school id directly —
   * every other managed call is produced by the automatic path remap while the
   * context is active.
   */

  /** Super Admin enters the school: opens (or supersedes) the session. */
  public async startManagedSchoolSession(
    schoolId: string,
  ): Promise<ApiResponse<AssistedSessionStartResponse>> {
    return this.post<AssistedSessionStartResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/manage/session`,
    );
  }

  /** Open session of the current Super Admin in the school, if any. */
  public async getManagedSchoolSession(
    schoolId: string,
  ): Promise<ApiResponse<AssistedSessionCurrentResponse>> {
    return this.get<AssistedSessionCurrentResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/manage/session/current`,
    );
  }

  /** Super Admin exits the school (idempotent). */
  public async endManagedSchoolSession(
    schoolId: string,
  ): Promise<ApiResponse<AssistedSessionEndResponse>> {
    return this.post<AssistedSessionEndResponse>(
      `/admin/schools/${encodeURIComponent(schoolId)}/manage/session/end`,
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
    const suffix = querySuffix(params);
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
    const suffix = querySuffix(params);
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
   * Read-only Parent Portal (Task 20) — served under `/api/v1/parent/*` and
   * reachable only by an authenticated PARENT. The API derives the tenant and
   * the parent identity from the JWT, so none of these methods send a parent
   * id or school id.
   */

  /** Parent dashboard: profile + today's view of the parent's own children. */
  public async getParentDashboard(): Promise<ApiResponse<ParentDashboardResponse>> {
    return this.get<ParentDashboardResponse>('/parent/dashboard');
  }

  /** The authenticated parent's own children (today's trip included). */
  public async listParentChildren(): Promise<ApiResponse<ParentChildListResponse>> {
    return this.get<ParentChildListResponse>('/parent/children');
  }

  /** One linked child with today's crew. 404 when not associated with parent. */
  public async getParentChild(id: string): Promise<ApiResponse<ParentChildDetailResponse>> {
    return this.get<ParentChildDetailResponse>(`/parent/children/${encodeURIComponent(id)}`);
  }

  /** One child's today's trip + attendance + route stops. */
  public async getParentChildToday(id: string): Promise<ApiResponse<ParentChildTodayResponse>> {
    return this.get<ParentChildTodayResponse>(`/parent/children/${encodeURIComponent(id)}/today`);
  }

  /** One child's active trip + route stops + crew + latest verified GPS fix. */
  public async getParentChildTracking(id: string): Promise<ApiResponse<ParentTrackingResponse>> {
    return this.get<ParentTrackingResponse>(`/parent/children/${encodeURIComponent(id)}/tracking`);
  }

  /**
   * Parent notifications (Task 21) — served under `/api/v1/parent/notifications`
   * and reachable only by an authenticated PARENT. The API derives the tenant
   * and the parent identity from the JWT, so none of these methods send a
   * parent id or school id.
   */

  /** The authenticated parent's own notifications, newest first. */
  public async listParentNotifications(
    query: ParentNotificationListQuery = {},
  ): Promise<ApiResponse<ParentNotificationListResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.status) params.set('status', query.status);
    const suffix = querySuffix(params);
    return this.get<ParentNotificationListResponse>(`/parent/notifications${suffix}`);
  }

  /** Marks one of the authenticated parent's own notifications as read. */
  public async markParentNotificationRead(id: string): Promise<ApiResponse<NotificationResponse>> {
    return this.patch<NotificationResponse>(`/parent/notifications/${encodeURIComponent(id)}/read`);
  }

  /** Marks all of the authenticated parent's unread notifications as read. */
  public async markAllParentNotificationsRead(): Promise<ApiResponse<NotificationReadAllResponse>> {
    return this.patch<NotificationReadAllResponse>('/parent/notifications/read-all');
  }

  /**
   * Push device registration (Task 46) — reachable by any school role
   * (parent and crew). The API derives the tenant and the user from the JWT,
   * so the request body contains only the device's own native token.
   */
  public async registerDeviceToken(
    body: DeviceTokenRegisterRequest,
  ): Promise<ApiResponse<DeviceTokenResponse>> {
    return this.post<DeviceTokenResponse>('/notifications/devices', body);
  }

  /** Unregisters the caller's own device token (logout). */
  public async unregisterDeviceToken(
    token: string,
  ): Promise<ApiResponse<DeviceTokenUnregisterResponse>> {
    return this.delete<DeviceTokenUnregisterResponse>(
      `/notifications/devices/${encodeURIComponent(token)}`,
    );
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
    const suffix = querySuffix(params);
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
    const suffix = querySuffix(params);
    return this.get<RouteListResponse>(`/routes${suffix}`);
  }

  public async getRoute(id: string): Promise<ApiResponse<RouteResponse>> {
    return this.get<RouteResponse>(`/routes/${encodeURIComponent(id)}`);
  }

  /** Full route detail: route facts, stops, students and the active trip. */
  public async getRouteDetails(id: string): Promise<ApiResponse<RouteDetailResponse>> {
    return this.get<RouteDetailResponse>(`/routes/${encodeURIComponent(id)}/details`);
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
    const suffix = querySuffix(params);
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
    const suffix = querySuffix(params);
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
    const suffix = querySuffix(params);
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
    if (query.search) params.set('search', query.search);
    if (query.route_id) params.set('route_id', query.route_id);
    if (query.bus_id) params.set('bus_id', query.bus_id);
    if (query.user_id) params.set('user_id', query.user_id);
    if (query.role) params.set('role', query.role);
    if (query.is_active !== undefined) params.set('is_active', String(query.is_active));
    const suffix = querySuffix(params);
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
    if (query.search) params.set('search', query.search);
    if (query.route_id) params.set('route_id', query.route_id);
    if (query.bus_id) params.set('bus_id', query.bus_id);
    if (query.user_id) params.set('user_id', query.user_id);
    if (query.role) params.set('role', query.role);
    if (query.is_active !== undefined) params.set('is_active', String(query.is_active));
    const suffix = querySuffix(params);
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
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.route_id) params.set('route_id', query.route_id);
    if (query.bus_id) params.set('bus_id', query.bus_id);
    if (query.driver_id) params.set('driver_id', query.driver_id);
    if (query.conductor_id) params.set('conductor_id', query.conductor_id);
    if (query.date) params.set('date', query.date);
    if (query.date_from) params.set('date_from', query.date_from);
    if (query.date_to) params.set('date_to', query.date_to);
    const suffix = querySuffix(params);
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
    const suffix = querySuffix(params);
    return this.get<TripLocationHistoryResponse>(
      `/trips/${encodeURIComponent(tripId)}/location/history${suffix}`,
    );
  }

  /**
   * Task 22 — approximate ETA, stop arrivals and crew progress. The API
   * resolves the trip inside the caller's tenant and authorizes the caller
   * for it (the same observer rule as the location endpoints), so these
   * methods never send a tenant id or any coordinates. The ETA is
   * GPS-based (Haversine + device/fallback speed), never road-routing.
   */

  /** Approximate ETA/progress summary of the trip (`GET /trips/:tripId/eta`). */
  public async getTripEta(tripId: string): Promise<ApiResponse<TripEtaResponse>> {
    return this.get<TripEtaResponse>(`/trips/${encodeURIComponent(tripId)}/eta`);
  }

  /** Every recorded stop arrival of the trip (`GET /trips/:tripId/arrivals`). */
  public async getTripArrivals(tripId: string): Promise<ApiResponse<TripStopArrivalListResponse>> {
    return this.get<TripStopArrivalListResponse>(`/trips/${encodeURIComponent(tripId)}/arrivals`);
  }

  /**
   * Crew progress snapshot: current/next stop, arrivals and the ETA summary
   * (`GET /trips/:tripId/progress`).
   */
  public async getTripProgress(tripId: string): Promise<ApiResponse<TripProgressResponse>> {
    return this.get<TripProgressResponse>(`/trips/${encodeURIComponent(tripId)}/progress`);
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
    const suffix = querySuffix(params);
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

  /**
   * Task 44 — Bus & driver compliance documents.
   *
   * Every call is tenant-free: the API derives `school_id` from the bearer
   * token and pins the owner (bus / driver) from the route, so a client can
   * neither select a tenant nor spoof a document status — validity is always
   * derived server-side from the real expiry date.
   */
  public async listBusDocuments(
    busId: string,
    query: DocumentListQuery = {},
  ): Promise<ApiResponse<BusDocumentListResponse>> {
    return this.get<BusDocumentListResponse>(
      `/buses/${encodeURIComponent(busId)}/documents${documentQuerySuffix(query)}`,
    );
  }

  public async createBusDocument(
    busId: string,
    body: BusDocumentCreateRequest,
  ): Promise<ApiResponse<BusDocumentResponse>> {
    return this.post<BusDocumentResponse>(`/buses/${encodeURIComponent(busId)}/documents`, body);
  }

  public async getBusDocument(
    busId: string,
    id: string,
  ): Promise<ApiResponse<BusDocumentResponse>> {
    return this.get<BusDocumentResponse>(
      `/buses/${encodeURIComponent(busId)}/documents/${encodeURIComponent(id)}`,
    );
  }

  public async updateBusDocument(
    busId: string,
    id: string,
    body: BusDocumentUpdateRequest,
  ): Promise<ApiResponse<BusDocumentResponse>> {
    return this.patch<BusDocumentResponse>(
      `/buses/${encodeURIComponent(busId)}/documents/${encodeURIComponent(id)}`,
      body,
    );
  }

  public async deleteBusDocument(
    busId: string,
    id: string,
  ): Promise<ApiResponse<DocumentDeleteResponse>> {
    return this.delete<DocumentDeleteResponse>(
      `/buses/${encodeURIComponent(busId)}/documents/${encodeURIComponent(id)}`,
    );
  }

  /** Missing / valid / expiring / expired requirements of one bus. */
  public async getBusDocumentCompliance(
    busId: string,
  ): Promise<ApiResponse<DocumentComplianceResponse>> {
    return this.get<DocumentComplianceResponse>(
      `/buses/${encodeURIComponent(busId)}/documents/compliance`,
    );
  }

  public async listDriverDocuments(
    driverId: string,
    query: DocumentListQuery = {},
  ): Promise<ApiResponse<DriverDocumentListResponse>> {
    return this.get<DriverDocumentListResponse>(
      `/drivers/${encodeURIComponent(driverId)}/documents${documentQuerySuffix(query)}`,
    );
  }

  public async createDriverDocument(
    driverId: string,
    body: DriverDocumentCreateRequest,
  ): Promise<ApiResponse<DriverDocumentResponse>> {
    return this.post<DriverDocumentResponse>(
      `/drivers/${encodeURIComponent(driverId)}/documents`,
      body,
    );
  }

  public async getDriverDocument(
    driverId: string,
    id: string,
  ): Promise<ApiResponse<DriverDocumentResponse>> {
    return this.get<DriverDocumentResponse>(
      `/drivers/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(id)}`,
    );
  }

  public async updateDriverDocument(
    driverId: string,
    id: string,
    body: DriverDocumentUpdateRequest,
  ): Promise<ApiResponse<DriverDocumentResponse>> {
    return this.patch<DriverDocumentResponse>(
      `/drivers/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(id)}`,
      body,
    );
  }

  public async deleteDriverDocument(
    driverId: string,
    id: string,
  ): Promise<ApiResponse<DocumentDeleteResponse>> {
    return this.delete<DocumentDeleteResponse>(
      `/drivers/${encodeURIComponent(driverId)}/documents/${encodeURIComponent(id)}`,
    );
  }

  /** Missing / valid / expiring / expired requirements of one driver. */
  public async getDriverDocumentCompliance(
    driverId: string,
  ): Promise<ApiResponse<DocumentComplianceResponse>> {
    return this.get<DocumentComplianceResponse>(
      `/drivers/${encodeURIComponent(driverId)}/documents/compliance`,
    );
  }

  /** School-wide compliance overview (every bus and driver, newest issues). */
  public async getDocumentOverview(
    query: DocumentOverviewQuery = {},
  ): Promise<ApiResponse<DocumentOverviewResponse>> {
    const params = new URLSearchParams();
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    if (query.owner_type) params.set('owner_type', query.owner_type);
    if (query.compliance) params.set('compliance', query.compliance);
    if (query.search) params.set('search', query.search);
    const suffix = querySuffix(params);
    return this.get<DocumentOverviewResponse>(`/documents/overview${suffix}`);
  }

  /** Effective required / optional configuration of one catalogue. */
  public async getDocumentRequirements(
    query: DocumentRequirementsListQuery,
  ): Promise<ApiResponse<DocumentRequirementsResponse>> {
    const params = new URLSearchParams();
    params.set('owner_type', query.owner_type);
    return this.get<DocumentRequirementsResponse>(`/document-requirements?${params.toString()}`);
  }

  /** Overrides the school's own required / optional configuration. */
  public async updateDocumentRequirements(
    body: DocumentRequirementsUpdateRequest,
  ): Promise<ApiResponse<DocumentRequirementsResponse>> {
    return this.put<DocumentRequirementsResponse>('/document-requirements', body);
  }

  /**
   * Task 44 — Emergency / SOS.
   *
   * `raiseSos` is crew-only on the server; the rest are the school-admin
   * console and the crew member's own history. No paid SMS / push provider is
   * involved — delivery is the self-hosted Socket.IO feed.
   */
  public async raiseSos(body: EmergencySosRequest): Promise<ApiResponse<EmergencyEventResponse>> {
    return this.post<EmergencyEventResponse>('/emergencies/sos', body);
  }

  /** The signed-in crew member's own SOS history. */
  public async listMyEmergencies(
    query: EmergencyListQuery = {},
  ): Promise<ApiResponse<EmergencyEventListResponse>> {
    return this.get<EmergencyEventListResponse>(`/emergencies/mine${emergencyQuerySuffix(query)}`);
  }

  /** Retracts an alarm the signed-in crew member raised by mistake. */
  public async cancelMyEmergency(
    id: string,
    body: EmergencyStatusUpdateRequest = { status: EmergencyStatus.CANCELLED },
  ): Promise<ApiResponse<EmergencyEventResponse>> {
    return this.patch<EmergencyEventResponse>(
      `/emergencies/${encodeURIComponent(id)}/cancel`,
      body,
    );
  }

  /** Everything still needing the school's attention. */
  public async listActiveEmergencies(): Promise<ApiResponse<EmergencyActiveListResponse>> {
    return this.get<EmergencyActiveListResponse>('/emergencies/active');
  }

  public async listEmergencies(
    query: EmergencyListQuery = {},
  ): Promise<ApiResponse<EmergencyEventListResponse>> {
    return this.get<EmergencyEventListResponse>(`/emergencies${emergencyQuerySuffix(query)}`);
  }

  public async getEmergency(id: string): Promise<ApiResponse<EmergencyEventResponse>> {
    return this.get<EmergencyEventResponse>(`/emergencies/${encodeURIComponent(id)}`);
  }

  /** Acknowledges, resolves or cancels an incident (school admin). */
  public async updateEmergencyStatus(
    id: string,
    body: EmergencyStatusUpdateRequest,
  ): Promise<ApiResponse<EmergencyEventResponse>> {
    return this.patch<EmergencyEventResponse>(
      `/emergencies/${encodeURIComponent(id)}/status`,
      body,
    );
  }

  // ---------------------------------------------------------------------------
  // Import / export / reports
  // ---------------------------------------------------------------------------

  /**
   * Fetches a binary download (template, export, report, error workbook).
   *
   * File endpoints deliberately bypass the JSON `{ success, data }` envelope,
   * so they cannot go through {@link request} — the response body is a
   * spreadsheet, not JSON. Everything else about the call is identical:
   * bearer token, cookie credentials, a single refresh-and-replay on 401, and
   * the same {@link ApiClientError} on failure.
   */
  public async downloadFile(
    endpoint: string,
    options: RequestInit = {},
    skipRefresh = false,
  ): Promise<DownloadedFile> {
    endpoint = this.effectiveEndpoint(endpoint);
    const url = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const headers = this.mergeHeaders(options.headers);

    if (!headers.Authorization && !headers.authorization) {
      const token = this.getAccessToken?.();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }
    const sendsBearer = Boolean(headers.Authorization || headers.authorization);
    await this.applyCsrfHeader(options.method || 'GET', headers, !sendsBearer);

    let response: Response;
    try {
      response = await fetch(url, { credentials: 'include', ...options, headers });
    } catch (error) {
      throw new ApiClientError(
        error instanceof Error ? error.message : 'Unknown network error',
        0,
        error,
      );
    }

    if (response.status === 401 && !skipRefresh) {
      const refreshed = await this.refreshSession();
      if (refreshed) {
        return this.downloadFile(endpoint, options, true);
      }
      this.onUnauthorized?.();
    }

    if (!response.ok) {
      // An error response *is* JSON even on a download route, because the
      // failure happens before any bytes of the file are written.
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

    return {
      blob: await response.blob(),
      fileName:
        fileNameFromContentDisposition(response.headers.get('content-disposition')) ??
        defaultFileName(endpoint),
      totalRecords: parseTotalRecords(response.headers.get('x-total-records')),
    };
  }

  /** Metadata for every importable module (columns, examples, natural key). */
  public async listImportModules(): Promise<ApiResponse<ImportModuleListResponse>> {
    return this.get<ImportModuleListResponse>('/imports/modules');
  }

  /** Downloads the blank import template for a module. */
  public async downloadImportTemplate(
    module: ImportModule,
    format: DataFileFormat = DataFileFormat.XLSX,
  ): Promise<DownloadedFile> {
    const params = new URLSearchParams({ format });
    return this.downloadFile(
      `/imports/${encodeURIComponent(module)}/template${querySuffix(params)}`,
    );
  }

  /**
   * Dry run: validates an uploaded spreadsheet without writing anything.
   *
   * The body is `FormData`, so `Content-Type` is deliberately *not* set —
   * the browser has to add its own multipart boundary, and a hand-written
   * header would make the request unparseable.
   */
  public async validateImport(
    module: ImportModule,
    file: File | Blob,
    mode: ImportMode,
    fileName?: string,
  ): Promise<ApiResponse<ImportValidationResponse>> {
    return this.request<ApiResponse<ImportValidationResponse>>(
      `/imports/${encodeURIComponent(module)}/validate${querySuffix(
        new URLSearchParams({ mode }),
      )}`,
      { method: 'POST', body: toFormData(file, fileName) },
    );
  }

  /** Writes the valid rows of an uploaded spreadsheet. */
  public async commitImport(
    module: ImportModule,
    file: File | Blob,
    mode: ImportMode,
    fileName?: string,
  ): Promise<ApiResponse<ImportCommitResponse>> {
    return this.request<ApiResponse<ImportCommitResponse>>(
      `/imports/${encodeURIComponent(module)}/commit${querySuffix(new URLSearchParams({ mode }))}`,
      { method: 'POST', body: toFormData(file, fileName) },
    );
  }

  /** Paginated import history of the authenticated school. */
  public async listImportJobs(
    query: ImportJobListQuery = {},
  ): Promise<ApiResponse<ImportJobListResponse>> {
    return this.get<ImportJobListResponse>(`/imports/history${importJobQuerySuffix(query)}`);
  }

  /** One import run with its stored per-row errors. */
  public async getImportJob(id: string): Promise<ApiResponse<ImportJobDetailResponse>> {
    return this.get<ImportJobDetailResponse>(`/imports/history/${encodeURIComponent(id)}`);
  }

  /** Rebuilds and downloads the error workbook of a past run. */
  public async downloadImportErrorFile(id: string): Promise<DownloadedFile> {
    return this.downloadFile(`/imports/history/${encodeURIComponent(id)}/error-file`);
  }

  /** Streams a dataset export, honouring the caller's list filters. */
  public async downloadExport(
    dataset: ExportDataset,
    query: ExportQuery = {},
  ): Promise<DownloadedFile> {
    return this.downloadFile(`/exports/${encodeURIComponent(dataset)}${exportQuerySuffix(query)}`);
  }

  /** Catalogue of available reports and the filters each one supports. */
  public async listReports(): Promise<ApiResponse<ReportCatalogueResponse>> {
    return this.get<ReportCatalogueResponse>('/reports');
  }

  /** Headline figures for the reports landing page. */
  public async getReportOverview(): Promise<ApiResponse<ReportOverviewResponse>> {
    return this.get<ReportOverviewResponse>('/reports/overview');
  }

  /** Runs one report and returns summary cards plus a paginated table. */
  public async runReport(
    report: ReportType,
    query: ReportQuery = {},
  ): Promise<ApiResponse<ReportResultResponse>> {
    return this.get<ReportResultResponse>(
      `/reports/${encodeURIComponent(report)}${reportQuerySuffix(query)}`,
    );
  }

  /** Downloads a report with the same filters as the on-screen table. */
  public async downloadReport(
    report: ReportType,
    query: ReportQuery = {},
  ): Promise<DownloadedFile> {
    return this.downloadFile(
      `/reports/${encodeURIComponent(report)}/export${reportQuerySuffix(query)}`,
    );
  }
}

export const createApiClient = (config: ApiClientConfig): ApiClient => {
  return new ApiClient(config);
};

/**
 * Serialises `params` into a `?a=1&b=2` suffix (or `''` when empty).
 *
 * Deliberately derived from `toString()` rather than `URLSearchParams.size`:
 * `size` is a comparatively recent addition to the WHATWG URL spec and is
 * **not implemented by the React Native / Expo URL polyfill**
 * (`whatwg-url-without-unicode`), where it evaluates to `undefined`. A
 * `params.size > 0` guard therefore silently returned `''` on mobile, so every
 * list request was sent with no query string at all — no `page`, no `limit`
 * and, most visibly, no `search`. Browsers implement `size`, which is why the
 * web app was unaffected.
 *
 * `toString()` is part of the original URLSearchParams API and behaves
 * identically in browsers, Node and the React Native polyfill.
 */
export function querySuffix(params: URLSearchParams): string {
  const serialised = params.toString();
  return serialised.length > 0 ? `?${serialised}` : '';
}

/** Query string of the bus/driver document list endpoints. */
function documentQuerySuffix(query: DocumentListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.document_type) params.set('document_type', query.document_type);
  if (query.status) params.set('status', query.status);
  return querySuffix(params);
}

/** Query string of the emergency list endpoints. */
function emergencyQuerySuffix(query: EmergencyListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.status) params.set('status', query.status);
  if (query.type) params.set('type', query.type);
  if (query.trip_id) params.set('trip_id', query.trip_id);
  if (query.bus_id) params.set('bus_id', query.bus_id);
  if (query.date_from) params.set('date_from', query.date_from);
  if (query.date_to) params.set('date_to', query.date_to);
  return querySuffix(params);
}

/** A binary download plus the file name the server suggested. */
export interface DownloadedFile {
  blob: Blob;
  fileName: string;
  /** Rows the server matched, when it reported them (`X-Total-Records`). */
  totalRecords: number | null;
}

/**
 * Wraps a file in `FormData` under the `file` field the API expects.
 *
 * A `File` already carries its name; a bare `Blob` does not, so one is
 * supplied — multer needs a filename to derive the extension the import
 * endpoints validate.
 */
function toFormData(file: File | Blob, fileName?: string): FormData {
  const form = new FormData();
  const name =
    fileName ?? (typeof File !== 'undefined' && file instanceof File ? file.name : 'import.xlsx');
  form.append('file', file, name);
  return form;
}

/** True when `body` is a FormData payload that must set its own Content-Type. */
function isFormDataBody(body: unknown): boolean {
  if (body == null) {
    return false;
  }
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    return true;
  }
  // Some runtimes (React Native) expose a different FormData constructor.
  return Object.prototype.toString.call(body) === '[object FormData]';
}

/** Removes a header by name, case-insensitively. */
function stripHeader(headers: Record<string, string>, name: string): void {
  const needle = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === needle) {
      delete headers[key];
    }
  }
}

/**
 * Extracts the download name from a `Content-Disposition` header.
 *
 * The RFC 5987 `filename*` form is preferred (it survives non-ASCII names);
 * the quoted ASCII `filename` is the fallback.
 */
export function fileNameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the ASCII form on a malformed encoding.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

/** Last path segment of an endpoint, used when the server sent no name. */
function defaultFileName(endpoint: string): string {
  const path = endpoint.split('?')[0];
  const segment = path.split('/').filter(Boolean).pop() ?? 'download';
  return segment.includes('.') ? segment : `${segment}.xlsx`;
}

function parseTotalRecords(header: string | null): number | null {
  if (!header) return null;
  const value = Number(header);
  return Number.isFinite(value) ? value : null;
}

/** Query string of `GET /api/v1/imports/history`. */
function importJobQuerySuffix(query: ImportJobListQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.module) params.set('module', query.module);
  if (query.status) params.set('status', query.status);
  if (query.date_from) params.set('date_from', query.date_from);
  if (query.date_to) params.set('date_to', query.date_to);
  return querySuffix(params);
}

/** Query string of `GET /api/v1/exports/:dataset`. */
function exportQuerySuffix(query: ExportQuery): string {
  const params = new URLSearchParams();
  if (query.format) params.set('format', query.format);
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.route_id) params.set('route_id', query.route_id);
  if (query.bus_id) params.set('bus_id', query.bus_id);
  if (query.stop_id) params.set('stop_id', query.stop_id);
  if (query.driver_id) params.set('driver_id', query.driver_id);
  if (query.conductor_id) params.set('conductor_id', query.conductor_id);
  if (query.parent_id) params.set('parent_id', query.parent_id);
  if (query.student_id) params.set('student_id', query.student_id);
  if (query.trip_id) params.set('trip_id', query.trip_id);
  if (query.date_from) params.set('date_from', query.date_from);
  if (query.date_to) params.set('date_to', query.date_to);
  return querySuffix(params);
}

/** Query string of the report endpoints. */
function reportQuerySuffix(query: ReportQuery): string {
  const params = new URLSearchParams();
  if (query.page !== undefined) params.set('page', String(query.page));
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.route_id) params.set('route_id', query.route_id);
  if (query.bus_id) params.set('bus_id', query.bus_id);
  if (query.stop_id) params.set('stop_id', query.stop_id);
  if (query.driver_id) params.set('driver_id', query.driver_id);
  if (query.student_id) params.set('student_id', query.student_id);
  if (query.trip_status) params.set('trip_status', query.trip_status);
  if (query.attendance_status) params.set('attendance_status', query.attendance_status);
  if (query.date_from) params.set('date_from', query.date_from);
  if (query.date_to) params.set('date_to', query.date_to);
  if (query.format) params.set('format', query.format);
  return querySuffix(params);
}
