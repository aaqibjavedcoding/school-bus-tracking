import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';

/**
 * Non-native push wiring (fallback module).
 *
 * The real implementation lives in `./push-notifications.native.ts`; Metro
 * resolves that file for Android/iOS bundles. This base module is what
 * TypeScript resolves for the public `./notifications` barrel, and what the
 * plain-Node test runner (and any non-native bundling) loads.
 *
 * It intentionally contains **no** `expo-notifications` import and no native
 * calls: `expo-notifications` evaluates its `.native.ts` modules at import
 * time (calling `requireNativeModule(...)` for native modules Expo Go does not
 * ship), so keeping this module free of that dependency guarantees the base
 * path can never crash a module evaluation.
 */
export async function setupPushNotifications(_user: AuthenticatedUser): Promise<void> {
  // No native runtime here (Node tests, non-native bundling): remote push is
  // not available, so setup safely no-ops. The native implementation in
  // `./push-notifications.native.ts` performs the real registration.
}

export async function unregisterPushDevice(): Promise<void> {
  // No device token was ever registered on this (non-native) path.
}

export function flushPendingRoute(): void {
  // Nothing was queued on the non-native path.
}
