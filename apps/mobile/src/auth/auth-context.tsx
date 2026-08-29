import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AuthenticatedUser, LoginRequest } from '@school-bus-tracking/shared-types';
import { loginSchema } from '@school-bus-tracking/validation';
import { ensureGlobalSessionBootstrapped, getGlobalSession } from './global-session';
import type { LoginOutcome, SessionSnapshot } from './mobile-session';

/**
 * React binding for `MobileSession`.
 *
 * Role/tenant for navigation come from `user` — the verified identity the API
 * returned for the bearer token — never from anything the user typed. The API
 * keeps enforcing RBAC on every request regardless.
 */

export interface AuthContextValue extends SessionSnapshot {
  login: (input: { school_id: string; email: string; password: string }) => Promise<LoginOutcome>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const session = getGlobalSession();
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(session.getSnapshot());

  useEffect(() => {
    const unsubscribe = session.subscribe(() => setSnapshot(session.getSnapshot()));
    void ensureGlobalSessionBootstrapped().finally(() => setSnapshot(session.getSnapshot()));
    return unsubscribe;
  }, [session]);

  const login = useCallback<AuthContextValue['login']>(
    async ({ school_id, email, password }) => {
      const parsed = loginSchema.safeParse({
        school_id: school_id.trim() === '' ? null : school_id.trim(),
        email: email.trim(),
        password,
      });
      if (!parsed.success) {
        const fieldErrors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const key = String(issue.path[0] ?? 'form');
          if (!fieldErrors[key]) {
            fieldErrors[key] = issue.message;
          }
        }
        return {
          ok: false,
          message: Object.values(fieldErrors)[0] ?? 'Check the form and try again.',
          fieldErrors,
        };
      }
      const request: LoginRequest = {
        school_id: parsed.data.school_id ?? null,
        email: parsed.data.email,
        password: parsed.data.password,
      };
      return session.login(request);
    },
    [session],
  );

  const logout = useCallback(async () => {
    await session.logout();
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({ ...snapshot, login, logout }),
    [snapshot, login, logout],
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

export function useCurrentUser(): AuthenticatedUser | null {
  return useAuth().user;
}
