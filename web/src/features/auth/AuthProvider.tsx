'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthenticatedUser, LoginRequest } from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import {
  clearAccessToken,
  clearSessionPresentCookie,
  getAccessToken,
  hasSessionPresentCookie,
  setAccessToken,
  setUnauthorizedHandler,
} from '../../services/session';
import {
  clearManagedSchool,
  getManagedSchool,
} from '../managed/managed-school-store';
import { disconnectAllSessionSockets } from '../../services/socket-registry';

type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

interface AuthContextValue {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  login: (body: LoginRequest) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  const clearSession = useCallback(() => {
    // Every authenticated socket must go with the session: the gateways
    // authenticate the handshake with the in-memory JWT, so a socket left
    // open after sign-out keeps reconnecting without one and is rejected
    // ("Rejected unauthenticated … socket") until the tab is closed.
    //
    // The realtime services register their disconnect routines in
    // `socket-registry` at import time, so this teardown stays synchronous
    // without forcing every page to load `socket.io-client` (only pages that
    // actually open a socket ever import those modules).
    disconnectAllSessionSockets();
    // An ended platform session must never keep a managed-school context: the
    // banner and the API-call remap both disappear with it. (Server-side, the
    // open session is closed on the next entry as `superseded`.)
    clearManagedSchool();
    // Mirror the API's cookie clearing locally: logout may have failed on the
    // network, but the tab must not keep believing a session may exist.
    clearSessionPresentCookie();
    clearAccessToken();
    setUser(null);
    setStatus('anonymous');
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      disconnectAllSessionSockets();
      clearSessionPresentCookie();
      clearAccessToken();
      setUser(null);
      setStatus('anonymous');
    });

    let cancelled = false;
    void (async () => {
      // No in-memory token and no session-presence marker means the browser
      // almost certainly holds no httpOnly refresh cookie (login, first
      // visit, post-logout). Both CSRF bootstrap and the refresh round trip
      // would come back empty — skip them instead of paying two requests on
      // every anonymous page load. Login itself never needs the CSRF cookie
      // without an existing session (the API's origin check + login rate
      // limiter guard it), and a real session in another tab always sets the
      // marker, so no recovery path is lost.
      if (!getAccessToken() && !hasSessionPresentCookie()) {
        setStatus('anonymous');
        return;
      }
      try {
        // Seed the double-submit CSRF cookie before the first state-changing
        // auth call. The API only issues it on login/refresh success and on
        // `GET /auth/csrf`; a tab that still holds the httpOnly refresh
        // cookie but no CSRF cookie would otherwise get 403 "Invalid or
        // missing CSRF token" on both refresh *and* login, with no way out.
        await apiClient.ensureCsrfToken();
        const envelope = await apiClient.refresh();
        if (cancelled) return;
        if (envelope.data?.access_token && envelope.data.user) {
          setAccessToken(envelope.data.access_token);
          setUser(envelope.data.user);
          setStatus('authenticated');
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
  }, []);

  const login = useCallback(async (body: LoginRequest) => {
    const envelope = await apiClient.login(body);
    if (!envelope.data?.access_token || !envelope.data.user) {
      throw new Error(envelope.error?.message || envelope.message || 'Sign in failed');
    }
    setAccessToken(envelope.data.access_token);
    setUser(envelope.data.user);
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    // Close an open assisted-management session first, while the access token
    // is still available — the audit trail then records a clean `exit`.
    const managed = getManagedSchool();
    if (managed) {
      try {
        await apiClient.endManagedSchoolSession(managed.schoolId);
      } catch {
        // Best effort; the session is superseded on the next entry either way.
      }
    }
    try {
      await apiClient.logout();
    } catch {
      // Clearing local session is enough even if the network call fails.
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo(() => ({ status, user, login, logout }), [status, user, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return value;
}
