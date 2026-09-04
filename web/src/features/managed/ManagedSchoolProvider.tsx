'use client';

import { useRouter } from 'next/navigation';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  AssistedSessionCurrentResponse,
  AssistedSessionStartResponse,
} from '@school-bus-tracking/shared-types';
import { apiClient } from '../../services/api';
import { getApiErrorMessage } from '../../lib/errors';
import {
  clearManagedSchool,
  getManagedSchool,
  setManagedSchool,
  subscribeManagedSchool,
  type ManagedSchoolState,
} from './managed-school-store';

interface ManagedSchoolContextValue {
  /** Active context, or `null` when not managing a school. */
  managed: ManagedSchoolState | null;
  /** True while the enter/exit calls are in flight. */
  busy: boolean;
  /** Entered but the server has not confirmed the session yet (restore). */
  verifying: boolean;
  /**
   * Enters the school: opens the assisted session server-side, activates the
   * managed context and navigates into the managed workspace.
   */
  enterSchool: (school: {
    id: string;
    name: string;
    code: string;
    is_active: boolean;
  }) => Promise<boolean>;
  /** Exits: closes the session server-side and returns to the schools list. */
  exitSchool: () => Promise<void>;
}

const ManagedSchoolContext = createContext<ManagedSchoolContextValue | null>(null);

/**
 * Lifecycle owner of the Super Admin assisted-management context.
 *
 * The provider does NOT impersonate anything and holds no credential change:
 * the user keeps their own Super Admin session, and entering a school merely
 * (1) opens an auditable assisted-management session on the API and (2) turns
 * on the client-side context that remaps tenant API calls onto the guarded
 * `/admin/schools/:id/manage/*` surface while showing a persistent banner.
 *
 * On mount an existing (sessionStorage-restored) context is re-validated
 * against `GET …/manage/session/current`; a context whose session the server
 * no longer knows about is discarded.
 */
export const ManagedSchoolProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const router = useRouter();
  const [managed, setManaged] = useState<ManagedSchoolState | null>(() => getManagedSchool());
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState<boolean>(() => getManagedSchool() !== null);

  useEffect(
    () =>
      subscribeManagedSchool(() => {
        setManaged(getManagedSchool());
      }),
    [],
  );

  // Restore validation: the sessionStorage mirror may be stale (closed in
  // another tab, server restarted, or the session was superseded).
  useEffect(() => {
    const existing = getManagedSchool();
    if (!existing) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const envelope = await apiClient.getManagedSchoolSession(existing.schoolId);
        if (cancelled) return;
        const payload = envelope.data as AssistedSessionCurrentResponse | undefined;
        if (!payload) {
          clearManagedSchool();
          return;
        }
        setManagedSchool({
          ...existing,
          sessionId: payload.session?.id ?? null,
          startedAt: payload.session?.started_at ?? null,
          schoolIsActive: payload.school.is_active,
        });
      } catch {
        if (!cancelled) {
          // Unknown school or network trouble — never keep a context the
          // server cannot confirm.
          clearManagedSchool();
        }
      } finally {
        if (!cancelled) setVerifying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enterSchool = useCallback<ManagedSchoolContextValue['enterSchool']>(
    async (school) => {
      setBusy(true);
      try {
        const envelope = await apiClient.startManagedSchoolSession(school.id);
        const payload = envelope.data as AssistedSessionStartResponse | undefined;
        if (!payload?.session) {
          throw new Error(envelope.error?.message || 'Unable to start assisted management');
        }
        setManagedSchool({
          schoolId: school.id,
          schoolName: payload.school?.name ?? school.name,
          schoolCode: payload.school?.code ?? school.code,
          schoolIsActive: payload.school?.is_active ?? school.is_active,
          sessionId: payload.session.id,
          startedAt: payload.session.started_at,
        });
        router.push('/students');
        return true;
      } catch (error) {
        throw new Error(getApiErrorMessage(error, 'Unable to start assisted management'));
      } finally {
        setBusy(false);
      }
    },
    [router],
  );

  const exitSchool = useCallback(async () => {
    const current = getManagedSchool();
    if (!current) {
      router.push('/admin/schools');
      return;
    }
    setBusy(true);
    try {
      await apiClient.endManagedSchoolSession(current.schoolId);
    } catch {
      // Exit is idempotent server-side; even on failure the local context goes
      // away — a superseding session is opened on the next entry.
    } finally {
      clearManagedSchool();
      setBusy(false);
      router.push('/admin/schools');
    }
  }, [router]);

  const value = useMemo(
    () => ({ managed, busy, verifying, enterSchool, exitSchool }),
    [managed, busy, verifying, enterSchool, exitSchool],
  );

  return <ManagedSchoolContext.Provider value={value}>{children}</ManagedSchoolContext.Provider>;
};

export function useManagedSchool(): ManagedSchoolContextValue {
  const value = useContext(ManagedSchoolContext);
  if (!value) {
    throw new Error('useManagedSchool must be used within ManagedSchoolProvider');
  }
  return value;
}
