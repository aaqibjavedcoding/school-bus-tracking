import {
  UserRole,
  type AuthenticatedUser,
  type LoginRequest,
} from '@school-bus-tracking/shared-types';
import { ApiClient, ApiClientError, ApiClientConfig } from '@school-bus-tracking/api-client';
import { rehydrateStorage, type KeyValueStorage } from '../storage/secure-store';
import { isNetworkError, getApiErrorMessage, getSignInErrorMessage } from '../utils/errors';

/**
 * The mobile session — the single place that owns tokens and the verified
 * user.
 *
 * Contract with the backend (unchanged, no mobile-only endpoints):
 *
 * - `POST /auth/login`   → access token in the JSON body; the raw refresh
 *   token is echoed in the body too because this client opts in via the
 *   `x-client-session` header (the shared api-client does this when a
 *   `getRefreshToken` accessor is configured).
 * - `POST /auth/refresh` → rotates the session; this client replays the
 *   stored refresh token as `body.refresh_token`, the documented fallback
 *   for non-browser clients that cannot hold an HttpOnly cookie.
 * - `POST /auth/logout`  → revokes the stored refresh token server-side.
 *
 * The role and school/tenant always come from the server-verified user in the
 * response — never from anything the app types into a request.
 */

export type SessionStatus = 'loading' | 'anonymous' | 'authenticated';

export interface SessionSnapshot {
  status: SessionStatus;
  user: AuthenticatedUser | null;
  /** True when bootstrap could not reach the API; tokens were kept. */
  networkError: boolean;
}

export interface LoginOutcome {
  ok: boolean;
  user?: AuthenticatedUser;
  message?: string;
  fieldErrors?: Record<string, string>;
}

/** Refresh this often before the access token actually expires. */
const REFRESH_SKEW_MS = 60_000;
/** Retry a failed proactive refresh after this delay. */
const RETRY_BACKOFF_MS = 15_000;
const FALLBACK_ACCESS_TTL_MS = 15 * 60_000;

export interface MobileSessionDeps {
  storage: KeyValueStorage;
  createClient: (
    accessors: Pick<
      ApiClientConfig,
      'getAccessToken' | 'setAccessToken' | 'getRefreshToken' | 'setRefreshToken' | 'onUnauthorized'
    >,
  ) => ApiClient;
  /** Fired after the session clears itself for any reason (logout/expiry). */
  onSignedOut?: (reason: 'logout' | 'expired' | 'invalid-session') => void;
}

/** Decodes the `exp` claim of a JWT *without verifying it* — the value is
 * only used to schedule refreshes; the API verifies every request anyway. */
export function parseAccessTokenExpiry(token: string): number | null {
  try {
    const payloadPart = token.split('.')[1];
    if (!payloadPart) return null;
    const json = decodeBase64Url(payloadPart);
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value: string): string {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
  // Hermes/JSC/Node all expose base-64 decoding through this shim chain in
  // the environments where the session actually runs (RN runtime and jest).
  const binary =
    typeof atob === 'function' ? atob(padded) : Buffer.from(padded, 'base64').toString('binary');
  return decodeURIComponent(
    binary
      .split('')
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''),
  );
}

export class MobileSession {
  private status: SessionStatus = 'loading';
  private networkError = false;
  private user: AuthenticatedUser | null = null;
  private accessToken: string | null = null;
  private accessTokenExpiresAt: number | null = null;
  private refreshPromise: Promise<boolean> | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly api: ApiClient;
  private hydrated: Promise<void> | null = null;

  constructor(private readonly deps: MobileSessionDeps) {
    this.api = deps.createClient({
      getAccessToken: () => this.accessToken,
      setAccessToken: (token) => this.applyAccessToken(token),
      getRefreshToken: async () => {
        await this.hydrated;
        return this.deps.storage.get('refresh_token');
      },
      setRefreshToken: (token) => {
        void this.deps.storage.set('refresh_token', token);
      },
      onUnauthorized: () => this.handleExpiredSession(),
    });
  }

  get apiClient(): ApiClient {
    return this.api;
  }

  getSnapshot(): SessionSnapshot {
    return { status: this.status, user: this.user, networkError: this.networkError };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Restores a persisted session; safe to call on every app launch. */
  async bootstrap(): Promise<void> {
    this.hydrated ??= (async () => {
      await rehydrateStorage(this.deps.storage);
    })();
    await this.hydrated;

    const refreshToken = this.deps.storage.get('refresh_token');
    if (!refreshToken) {
      this.emit({ status: 'anonymous', user: null });
      return;
    }

    // A still-valid access token (fresh app launch) skips the network round
    // trip entirely.
    const cachedAccess = this.deps.storage.get('access_token');
    const cachedExpiry = Number(this.deps.storage.get('expires_at') ?? '0');
    const cachedUser = this.parseStoredUser(this.deps.storage.get('user'));
    if (cachedAccess && cachedUser && cachedExpiry > Date.now() + REFRESH_SKEW_MS) {
      this.accessToken = cachedAccess;
      this.accessTokenExpiresAt = cachedExpiry;
      this.emit({ status: 'authenticated', user: cachedUser });
      return;
    }

    const refreshed = await this.refreshNow();
    if (refreshed) {
      return;
    }
    if (this.networkError) {
      // Keep the session: the app is offline, not logged out. UI shows the
      // offline banner and every guarded screen fails closed with its own
      // error state until connectivity returns.
      this.emit({ status: 'anonymous', user: null });
      return;
    }
    await this.clearLocalSession('invalid-session');
  }

  async login(input: LoginRequest): Promise<LoginOutcome> {
    try {
      const envelope = await this.api.login(input);
      const data = envelope.data;
      if (!data?.access_token || !data.user) {
        return { ok: false, message: envelope.error?.message || 'Sign in failed' };
      }
      this.applyUser(data.user);
      this.networkError = false;
      this.emit({ status: 'authenticated', user: data.user });
      return { ok: true, user: data.user };
    } catch (error) {
      if (isNetworkError(error)) {
        this.networkError = true;
        return {
          ok: false,
          message:
            'You appear to be offline. Check your connection and try again — no session was started.',
        };
      }
      if (error instanceof ApiClientError) {
        if (error.status === 401) {
          return {
            ok: false,
            message: getSignInErrorMessage(error, 'Invalid email, password or school code.'),
          };
        }
        if (error.status === 403) {
          return { ok: false, message: getSignInErrorMessage(error, 'This school is inactive.') };
        }
        return { ok: false, message: getApiErrorMessage(error, 'Sign in failed.') };
      }
      return { ok: false, message: 'Sign in failed.' };
    }
  }

  /** Proactive refresh used by the timer and the app-foreground handler. */
  async ensureFresh(): Promise<void> {
    if (this.status !== 'authenticated' || !this.accessToken) {
      return;
    }
    const expiresAt = this.accessTokenExpiresAt ?? 0;
    if (expiresAt - REFRESH_SKEW_MS > Date.now()) {
      this.scheduleRefresh();
      return;
    }
    const refreshed = await this.refreshNow();
    if (!refreshed && !this.networkError) {
      await this.clearLocalSession('expired');
    }
  }

  async logout(): Promise<void> {
    try {
      await this.api.logout();
    } catch {
      // Server-side revocation is best effort; the local session clears
      // unconditionally so a lost connection never strands the user signed in.
    }
    await this.clearLocalSession('logout');
  }

  /**
   * Resolves a usable access token, refreshing when expired. The Socket.IO
   * handshake calls this so reconnects after a long gap re-authenticate with
   * a fresh token instead of a dead one.
   */
  async getFreshAccessToken(): Promise<string | null> {
    await this.hydrated;
    if (this.accessToken && (this.accessTokenExpiresAt ?? 0) > Date.now() + 5_000) {
      return this.accessToken;
    }
    if (!this.deps.storage.get('refresh_token')) {
      return null;
    }
    const refreshed = await this.refreshNow();
    return refreshed ? this.accessToken : null;
  }

  private async refreshNow(): Promise<boolean> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      try {
        const envelope = await this.api.refresh();
        const data = envelope.data;
        if (!data?.access_token || !data.user) {
          return false;
        }
        this.applyUser(data.user);
        this.networkError = false;
        this.emit({ status: 'authenticated', user: data.user });
        return true;
      } catch (error) {
        if (isNetworkError(error)) {
          this.networkError = true;
          return false;
        }
        return false;
      }
    })().finally(() => {
      this.refreshPromise = null;
    });
    return this.refreshPromise;
  }

  private handleExpiredSession(): void {
    // Called by the api-client when a 401 could not be repaired with a
    // refresh: the session is over, so drop everything and let navigation
    // fall back to the login screen.
    void this.clearLocalSession('expired');
  }

  private async clearLocalSession(reason: 'logout' | 'expired' | 'invalid-session'): Promise<void> {
    this.stopRefreshTimer();
    await this.applyAccessToken(null);
    await this.deps.storage.set('refresh_token', null);
    await this.deps.storage.set('expires_at', null);
    await this.deps.storage.set('user', null);
    this.networkError = false;
    this.emit({ status: 'anonymous', user: null });
    this.deps.onSignedOut?.(reason);
  }

  private applyAccessToken(token: string | null): void | Promise<void> {
    this.accessToken = token;
    if (!token) {
      this.accessTokenExpiresAt = null;
      this.stopRefreshTimer();
      // “logout clears all storage keys” includes the cached access token.
      return this.deps.storage.set('access_token', null);
    }
    this.accessTokenExpiresAt =
      parseAccessTokenExpiry(token) ?? Date.now() + FALLBACK_ACCESS_TTL_MS;
    this.scheduleRefresh();
    return this.deps.storage.set('access_token', token);
  }

  private applyUser(user: AuthenticatedUser): void {
    this.user = user;
    void this.deps.storage.set('user', JSON.stringify(user));
    this.scheduleRefresh();
  }

  private scheduleRefresh(): void {
    this.stopRefreshTimer();
    if (this.status !== 'authenticated' && this.status !== 'loading') {
      // Only re-arm once a session actually exists.
      if (!this.accessToken) {
        return;
      }
    }
    if (!this.accessToken || this.accessTokenExpiresAt === null) {
      return;
    }
    const delay = Math.max(this.accessTokenExpiresAt - Date.now() - REFRESH_SKEW_MS, 1_000);
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.ensureFresh().catch(() => {
        this.refreshTimer = setTimeout(() => void this.ensureFresh(), RETRY_BACKOFF_MS);
      });
    }, delay);
    // Node keeps the loop alive otherwise; irrelevant on device, tidy in tests.
    if (typeof this.refreshTimer === 'object' && 'unref' in this.refreshTimer) {
      this.refreshTimer.unref();
    }
  }

  private stopRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private parseStoredUser(raw: string | null): AuthenticatedUser | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as AuthenticatedUser;
      // Defensive: a hand-edited storage value must never forge a session.
      if (
        typeof parsed?.id !== 'string' ||
        typeof parsed?.email !== 'string' ||
        !Object.values(UserRole).includes(parsed.role)
      ) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private emit(next: { status: SessionStatus; user: AuthenticatedUser | null }): void {
    this.status = next.status;
    this.user = next.user;
    this.listeners.forEach((listener) => listener());
  }
}
