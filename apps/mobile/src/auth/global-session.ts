import { createSecureStorage } from '../storage/secure-store';
import { createMobileApiClient } from '../api/client';
import { MobileSession } from './mobile-session';

/**
 * The app-wide session singleton.
 *
 * Both the UI context and headless entry points (the background GPS task can
 * fire after a process relaunch, where React never mounted) obtain the session
 * through this module, so token state and refresh bookkeeping live in exactly
 * one place per JS context.
 */

let session: MobileSession | null = null;
let bootstrapped: Promise<void> | null = null;

export interface SessionSideEffects {
  /** Fired after the session clears itself (logout, expiry, invalid token). */
  onSignedOut?: (reason: 'logout' | 'expired' | 'invalid-session') => void;
}

let sideEffects: SessionSideEffects = {};

/** Must be called before the first `getGlobalSession()` (app entry does). */
export function setSessionSideEffects(next: SessionSideEffects): void {
  sideEffects = next;
}

export function getGlobalSession(): MobileSession {
  if (session) {
    return session;
  }
  session = new MobileSession({
    storage: createSecureStorage(),
    createClient: (accessors) => createMobileApiClient(accessors),
    onSignedOut: (reason) => sideEffects.onSignedOut?.(reason),
  });
  return session;
}

/** Kick-off bootstrap exactly once; the root layout awaits this. */
export function ensureGlobalSessionBootstrapped(): Promise<void> {
  bootstrapped ??= getGlobalSession().bootstrap();
  return bootstrapped;
}

/** Test seam — drop the singleton between suites. */
export function __resetGlobalSessionForTests(): void {
  session = null;
  bootstrapped = null;
  sideEffects = {};
}
