import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthenticatedUser, CrewLoginRequest, LoginRequest } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { clearAccessToken, setAccessToken, setUnauthorizedHandler } from '../../services/session';
import { disconnectLiveTrackingSocket } from '../../services/live-tracking-socket';
import { disconnectNotificationsSocket } from '../../services/notifications-socket';
import { disconnectEmergenciesSocket } from '../../services/emergencies-socket';
import { endCrewTrackingSession } from '../crew/tracking-lifecycle';
import { setupPushNotifications, unregisterPushDevice } from '../notifications';

/**
 * Mobile auth context (port of the web AuthProvider onto the same
 * `/auth/login`, `/auth/refresh` and `/auth/logout` endpoints).
 *
 * The access token lives in JS memory only. The refresh token stays in the
 * httpOnly cookie the API set at login — React Native's cookie jar persists
 * it, so `refresh()` on app start restores the session across restarts
 * without the app ever storing a token. A failed refresh (401 without
 * cookie) drops back to the login screen via `notifyUnauthorized`.
 */
type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  login: (body: LoginRequest) => Promise<void>;
  /**
   * Crew mobile-login (Mobile-UX Phase 4b). A 4-digit PIN or a scanned QR
   * pairing code against `POST /auth/crew-login`. Throws on failure — the
   * login screen translates the error envelope into a user-facing message
   * via `crew-login-errors.ts`. On success the session is identical to an
   * email/password login (same JWT, same refresh rotation).
   */
  crewLogin: (body: CrewLoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  const clearSession = useCallback(() => {
    // GPS sharing and every namespace socket are role-scoped sessions; they
    // must never outlive the account that opened them. A socket left open
    // reconnects with an empty handshake token and is refused by the gateway
    // ("Rejected unauthenticated \u2026 socket") for as long as the app runs.
    // Cancels recovery, drops the held fix, stops the watcher and the OS
    // background task, and forgets the persisted context — so a late async
    // completion can never restart tracking or resume the next account's trip.
    void endCrewTrackingSession();
    disconnectLiveTrackingSocket();
    disconnectNotificationsSocket();
    disconnectEmergenciesSocket();
    // Local push binding is dropped synchronously (the API call, if any,
    // already ran in `logout` while the JWT was valid).
    void unregisterPushDevice();
    clearAccessToken();
    setUser(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => clearSession());

    let cancelled = false;
    void (async () => {
      try {
        const envelope = await apiClient.refresh();
        if (cancelled) return;
        if (envelope.data?.access_token && envelope.data.user) {
          setAccessToken(envelope.data.access_token);
          setUser(envelope.data.user);
          setStatus('authenticated');
          // Re-register the device token on every app start; the server
          // upserts, so a restored session is always in sync (any role).
          void setupPushNotifications(envelope.data.user);
          return;
        }
        setStatus('anonymous');
      } catch {
        if (!cancelled) setStatus('anonymous');
      }
    })();

    return () => {
      cancelled = true;
      setUnauthorizedHandler(null);
    };
  }, [clearSession]);

  const login = useCallback(async (body: LoginRequest) => {
    const envelope = await apiClient.login(body);
    if (!envelope.data?.access_token || !envelope.data.user) {
      throw new Error(envelope.error?.message || envelope.message || 'Sign in failed');
    }
    setAccessToken(envelope.data.access_token);
    setUser(envelope.data.user);
    setStatus('authenticated');
    // OS-level push after login, for every role (parents + crew + admin).
    void setupPushNotifications(envelope.data.user);
  }, []);

  /**
   * Crew PIN/QR login (Phase 4b). Mirrors `login()` — `apiClient.crewLogin`
   * already persists the access token in the session module before returning,
   * so this method only owns the React-side state transition and push
   * registration. Errors are thrown so the login screen can map them
   * through `crew-login-errors.ts`.
   */
  const crewLogin = useCallback(async (body: CrewLoginRequest) => {
    const envelope = await apiClient.crewLogin(body);
    if (!envelope.data?.access_token || !envelope.data.user) {
      throw new Error(envelope.error?.message || envelope.message || 'Sign in failed');
    }
    setUser(envelope.data.user);
    setStatus('authenticated');
    void setupPushNotifications(envelope.data.user);
  }, []);

  const logout = useCallback(async () => {
    // The device token must be released *before* the session is revoked:
    // `DELETE /notifications/devices/:token` is JWT-scoped. Bounded so a dead
    // network can never hold the user on the screen.
    await Promise.race([
      unregisterPushDevice(),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
    try {
      await apiClient.logout();
    } catch {
      // Clearing local session is enough even if the network call fails.
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(
    () => ({ status, user, login, crewLogin, logout }),
    [status, user, login, crewLogin, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
