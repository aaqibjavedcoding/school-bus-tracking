/**
 * Pure GPS permission evaluation (no native imports — unit-testable in plain
 * Node, like every other decision module in this app).
 *
 * The bug this replaces: the recovery panel requested the background
 * permission and then cleared the reported issue **without reading the
 * result**, so a driver who tapped "Grant permission", allowed "While using
 * the app" and denied "Allow all the time" was told everything was fine while
 * background tracking silently never started.
 *
 * Rules implemented here:
 *
 * - the issue is cleared only when *every required* check passes — foreground
 *   granted, location services on, and background granted **iff** background
 *   tracking is actually required (an explicit user opt-in, never assumed);
 * - approximate / reduced-accuracy authorization is its own issue: a coarse
 *   fix cannot confirm a 100 m geofence, so it must not be reported as "all
 *   good";
 * - "cannot ask again" is distinguished from a plain denial, because only the
 *   former can be fixed in OS settings;
 * - `null`/unavailable platform results stay `unavailable` — never guessed as
 *   granted.
 */

/** Coarse permission state the UI renders (mirrors expo-location outcomes). */
export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** iOS accuracy authorization as expo-location reports it. */
export type LocationAccuracyAuthorization = 'full' | 'reduced' | 'unknown';

export type GpsIssue =
  | 'none'
  | 'permission_denied'
  | 'permission_permanently_denied'
  | 'location_services_disabled'
  | 'background_permission_denied'
  | 'background_permission_unavailable'
  | 'location_accuracy_reduced';

/** The subset of an expo-location permission response this module reads. */
export interface LocationPermissionSnapshot {
  granted?: boolean | null;
  canAskAgain?: boolean | null;
  status?: string | null;
  ios?: { scope?: string | null; accuracy?: string | null } | null;
  android?: { accuracy?: string | null } | null;
}

/**
 * Maps a permission response onto the four UI states. `null` (the platform
 * refused to answer, e.g. background location on an unsupported device) is
 * `unavailable`, never `granted`.
 */
export function mapPermissionState(
  snapshot: LocationPermissionSnapshot | null | undefined,
): PermissionState {
  if (!snapshot) {
    return 'unavailable';
  }
  if (snapshot.granted === true || snapshot.status === 'granted') {
    return 'granted';
  }
  if (snapshot.status === 'undetermined' && snapshot.canAskAgain !== false) {
    return 'undetermined';
  }
  return snapshot.canAskAgain === false ? 'denied' : 'undetermined';
}

/**
 * The accuracy authorization the OS actually granted.
 *
 * iOS 14+ reports `ios.accuracy` (`full`/`reduced`); Android 12+ reports
 * `android.accuracy` (`fine`/`coarse`/`none`). Both are read, and anything
 * else is `unknown` — which is *not* treated as full precision.
 */
export function locationAccuracyAuthorization(
  snapshot: LocationPermissionSnapshot | null | undefined,
): LocationAccuracyAuthorization {
  const iosAccuracy = snapshot?.ios?.accuracy;
  if (iosAccuracy === 'full') {
    return 'full';
  }
  if (iosAccuracy === 'reduced') {
    return 'reduced';
  }
  const androidAccuracy = snapshot?.android?.accuracy;
  if (androidAccuracy === 'fine') {
    return 'full';
  }
  if (androidAccuracy === 'coarse') {
    return 'reduced';
  }
  if (androidAccuracy === 'none') {
    return 'reduced';
  }
  return 'unknown';
}

/** True when the granted accuracy is too coarse to confirm a stop geofence. */
export function isReducedAccuracy(authorization: LocationAccuracyAuthorization): boolean {
  return authorization === 'reduced';
}

export interface GpsPermissionEvaluation {
  issue: GpsIssue;
  foregroundPermission: PermissionState;
  backgroundPermission: PermissionState;
  accuracy: LocationAccuracyAuthorization;
  /** True only when every *required* check passed. */
  ready: boolean;
  /** True when the user may still be asked in-app (no settings trip needed). */
  canRequestAgain: boolean;
  /** True when only OS settings can fix this. */
  needsSettings: boolean;
}

export interface GpsPermissionInput {
  /** `Location.hasServicesEnabledAsync()` — a real reading, never assumed. */
  servicesEnabled: boolean | null;
  foreground: LocationPermissionSnapshot | null | undefined;
  background?: LocationPermissionSnapshot | null | undefined;
  /**
   * Background tracking is required only when the crew member explicitly
   * consented to it (the Help-screen switch) — granting "Always" is never
   * demanded just because foreground sharing was asked for.
   */
  backgroundRequired: boolean;
}

/**
 * Evaluates the current permission facts into one honest issue.
 *
 * Precedence (most blocking first): services off → foreground denied /
 * permanently denied → reduced accuracy → background unavailable / denied.
 */
export function evaluateGpsPermissions(input: GpsPermissionInput): GpsPermissionEvaluation {
  const foregroundPermission = mapPermissionState(input.foreground);
  const backgroundPermission = mapPermissionState(input.background ?? null);
  const accuracy = locationAccuracyAuthorization(input.foreground);
  const canAskAgain = input.foreground?.canAskAgain !== false;

  const base = {
    foregroundPermission,
    backgroundPermission,
    accuracy,
    canRequestAgain: canAskAgain,
  };

  if (input.servicesEnabled === false) {
    return { ...base, issue: 'location_services_disabled', ready: false, needsSettings: true };
  }

  if (foregroundPermission !== 'granted') {
    const issue: GpsIssue = canAskAgain ? 'permission_denied' : 'permission_permanently_denied';
    return {
      ...base,
      issue,
      ready: false,
      needsSettings: !canAskAgain,
    };
  }

  if (isReducedAccuracy(accuracy)) {
    return {
      ...base,
      issue: 'location_accuracy_reduced',
      ready: false,
      needsSettings: true,
    };
  }

  if (input.backgroundRequired) {
    if (backgroundPermission === 'unavailable') {
      return {
        ...base,
        issue: 'background_permission_unavailable',
        ready: false,
        needsSettings: false,
      };
    }
    if (backgroundPermission !== 'granted') {
      return {
        ...base,
        issue: 'background_permission_denied',
        ready: false,
        needsSettings: backgroundPermission === 'denied',
      };
    }
  }

  return { ...base, issue: 'none', ready: true, needsSettings: false };
}

/**
 * Evaluates the **result of a request** (not the stored state) — the fix for
 * "requested background, never read the answer".
 *
 * `backgroundRequested` distinguishes "we asked and were refused" from "we did
 * not ask" (the user has not consented to background tracking yet). Only the
 * former can report a background issue; the latter reports foreground success
 * without pretending background tracking is on.
 */
export function evaluatePermissionRequest(input: {
  servicesEnabled: boolean | null;
  foregroundResult: LocationPermissionSnapshot | null | undefined;
  backgroundResult?: LocationPermissionSnapshot | null | undefined;
  backgroundRequested: boolean;
  backgroundRequired: boolean;
}): GpsPermissionEvaluation {
  return evaluateGpsPermissions({
    servicesEnabled: input.servicesEnabled,
    foreground: input.foregroundResult,
    background: input.backgroundRequested ? (input.backgroundResult ?? null) : undefined,
    backgroundRequired: input.backgroundRequired && input.backgroundRequested,
  });
}

/** Issue codes that only OS settings can resolve (drives the Settings button). */
export const SETTINGS_ONLY_ISSUES: readonly GpsIssue[] = [
  'permission_permanently_denied',
  'location_services_disabled',
  'location_accuracy_reduced',
];

/** True when the issue can be retried by asking in-app again. */
export function isRequestableIssue(issue: GpsIssue): boolean {
  return issue === 'permission_denied' || issue === 'background_permission_denied';
}
