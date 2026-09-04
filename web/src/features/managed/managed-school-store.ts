'use client';

/**
 * Framework-agnostic store for the Super Admin assisted-management context
 * ("Manage Data").
 *
 * The store is deliberately plain state + subscribers — no React, no API
 * client — so it can be read from anywhere that must follow the managed
 * context (currently the API client's request mapper) without import cycles:
 *
 * - `services/api.ts` reads it to remap tenant endpoints onto
 *   `/admin/schools/:id/manage/...` while a session is active;
 * - `ManagedSchoolProvider` owns the lifecycle (enter / restore / exit) and
 *   mirrors the server's assisted-session state into it.
 *
 * The state is mirrored to `sessionStorage` so a full page reload inside the
 * managed area keeps the banner; the provider re-validates it against the API
 * on mount, so a stale or server-closed session never persists by accident.
 * The stored data is limited to the school's public identity — nothing about
 * the Super Admin's own account, and never a token.
 */

const STORAGE_KEY = 'sbt.managed_school.v1';

/** The managed-school context the Super Admin is currently operating on. */
export interface ManagedSchoolState {
  schoolId: string;
  schoolName: string;
  schoolCode: string;
  /** False when the managed tenant is deactivated (assisted mode is then read-only). */
  schoolIsActive: boolean;
  /** Open assisted-management session id recorded by the API. */
  sessionId: string | null;
  startedAt: string | null;
}

function readStored(): ManagedSchoolState | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManagedSchoolState> | null;
    if (
      parsed &&
      typeof parsed.schoolId === 'string' &&
      parsed.schoolId.length > 0 &&
      typeof parsed.schoolName === 'string'
    ) {
      return {
        schoolId: parsed.schoolId,
        schoolName: parsed.schoolName,
        schoolCode: typeof parsed.schoolCode === 'string' ? parsed.schoolCode : '',
        schoolIsActive: parsed.schoolIsActive !== false,
        sessionId: typeof parsed.sessionId === 'string' ? parsed.sessionId : null,
        startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : null,
      };
    }
  } catch {
    // Corrupted mirror — treat as absent; the provider will start fresh.
  }
  return null;
}

let state: ManagedSchoolState | null = readStored();
const listeners = new Set<() => void>();

function persist(): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    if (state) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Storage may be unavailable (private mode); in-memory state still works.
  }
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Current context, or `null` when the Super Admin is not managing a school. */
export function getManagedSchool(): ManagedSchoolState | null {
  return state;
}

/** Convenience accessor for the API client's request mapper. */
export function readManagedSchoolId(): string | null {
  return state?.schoolId ?? null;
}

/** Replaces the whole context (used by the provider after start/restore). */
export function setManagedSchool(next: ManagedSchoolState): void {
  state = next;
  persist();
  emit();
}

/** Patches the open-session identity without touching the school identity. */
export function setManagedSession(sessionId: string | null, startedAt: string | null): void {
  if (!state) {
    return;
  }
  state = { ...state, sessionId, startedAt };
  persist();
  emit();
}

/** Clears the context (exit, sign-out, or an invalid restore). */
export function clearManagedSchool(): void {
  if (!state) {
    return;
  }
  state = null;
  persist();
  emit();
}

/** Subscribes to context changes; returns an unsubscribe function. */
export function subscribeManagedSchool(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
