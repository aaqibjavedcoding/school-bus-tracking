/**
 * What this app can do at runtime, derived from injected facts about **where
 * the JS bundle is running** (Expo Go, development build, standalone) and the
 * platform.
 *
 * ### Why this module exists
 *
 * From Expo SDK 53 on (this project is on SDK 57) three capabilities that the
 * app used to take for granted no longer exist **inside the Expo Go app**:
 *
 * - Google Maps on Android — the Expo SDK 52 changelog ("Deprecations") states
 *   it: "Google Maps will no longer be supported in Expo Go for Android in
 *   SDK 53 … On iOS, Expo Go only supports Apple Maps. You can use Google
 *   Maps in development builds."
 * - Background location (`startLocationUpdatesAsync` / `expo-task-manager`) —
 *   expo-location itself warns "Background location is limited in Expo Go:
 *   On Android, it is not available at all" (a LogBox the driver saw on every
 *   hydrate).
 * - Remote push — Expo Go has no FCM/APNs registration of its own.
 *
 * The app has to say so **honestly** (a labelled panel instead of a blank
 * map, a specific message instead of "not available on this device") and must
 * never *call* an API that cannot work — every `hasStartedLocationUpdatesAsync`
 * / `startLocationUpdatesAsync` / `stopLocationUpdatesAsync` /
 * `getBackgroundPermissionsAsync` call inside Expo Go on Android is a warning
 * or a no-op, not a capability.
 *
 * ### How "Expo Go" is detected
 *
 * The facts come from `expo-constants`, read exactly once by the thin
 * side-effect module `runtime-env.ts` (the same pattern as `services/api-env.ts`
 * for the API base URL) and injected here:
 *
 * - `Constants.executionEnvironment` is `'storeClient'` for **both** Expo Go
 *   and development builds (the type definition says so), so it alone cannot
 *   tell them apart;
 * - `Constants.appOwnership` is `'expo'` **only inside the Expo Go app shell**
 *   (null in dev builds and standalone builds).
 *
 * Expo Go is therefore `executionEnvironment === 'storeClient'` **and**
 * `appOwnership === 'expo'`. A dev client reads as a normal native runtime
 * (everything available), which keeps its behaviour bit-for-bit unchanged.
 *
 * This module is pure — no React, no native imports — so every branch is
 * pinned by `runtime-environment.spec.ts` under plain `node --test`.
 */

/**
 * Raw values of `Constants.executionEnvironment` (expo-constants SDK 57).
 * Mirrored here as data so this module never imports `expo-constants` at
 * module scope (the spec must load under plain Node).
 */
export const EXECUTION_ENVIRONMENTS = {
  /** A bare workflow / existing React Native project. */
  Bare: 'bare',
  /** Production/release build (EAS build or a prebuilt native app). */
  Standalone: 'standalone',
  /** Expo Go **or** a development build built with `expo-dev-client`. */
  StoreClient: 'storeClient',
} as const;

/** `Constants.appOwnership` value that marks the Expo Go app shell. */
export const EXPO_GO_APP_OWNERSHIP = 'expo';

/** The injected facts `describeRuntime` decides from (all nullable). */
export interface RuntimeEnvironmentFacts {
  /** `Constants.executionEnvironment` (raw string value). */
  executionEnvironment: string | null;
  /** `Constants.appOwnership` (`'expo'` only inside the Expo Go shell). */
  appOwnership: string | null;
  /** `Platform.OS` (`'android'` | `'ios'` | `'web'` | …). */
  platform: string;
}

/** What the app can rely on in the current runtime. */
export interface RuntimeEnvironment {
  /** True only inside the Expo Go app (never in dev builds / standalone). */
  isExpoGo: boolean;
  /** The platform as reported by `Platform.OS`. */
  platform: string;
  /**
   * Whether the native map (react-native-maps) can render tiles here.
   *
   * False **only** in Expo Go on Android: SDK ≥ 53 removed Google Maps from
   * Expo Go for Android. iOS Expo Go runs Apple Maps, which works, so the
   * map stays available there; every native build (dev client, APK, AAB)
   * has Google Maps as soon as the key is wired at build time.
   */
  googleMapsAvailable: boolean;
  /**
   * Whether the OS background-location task can run here.
   *
   * False in Expo Go on every platform: on Android it is "not available at
   * all" (expo-location's own LogBox warning), on iOS it only works in the
   * simulator — which is not a device this product runs on. Foreground
   * `watchPositionAsync` is unaffected and keeps working in Expo Go.
   */
  backgroundLocationAvailable: boolean;
  /**
   * Whether remote push (FCM / APNs) can register here. False in Expo Go:
   * the Expo Go shell has no push registration of its own, so
   * `getDevicePushTokenAsync()` cannot succeed (existing behaviour, now
   * reported instead of surfacing as a red screen).
   */
  remotePushAvailable: boolean;
}

/** Why background location is unavailable — or `null` when it is available. */
export type BackgroundUnavailableReason = 'expo-go' | 'platform';

/** True only inside the Expo Go app shell (see the module header). */
export function isExpoGoEnvironment(facts: RuntimeEnvironmentFacts): boolean {
  return (
    facts.executionEnvironment === EXECUTION_ENVIRONMENTS.StoreClient &&
    facts.appOwnership === EXPO_GO_APP_OWNERSHIP
  );
}

/**
 * The reason the published tracking state carries when background location
 * cannot run: `'expo-go'` when the Expo Go shell is the cause (the user can
 * fix it — a development build), `'platform'` when the platform itself does
 * not offer it (nothing the user can do), `null` when background location is
 * available.
 */
export function backgroundUnavailableReasonFor(
  runtime: RuntimeEnvironment,
): BackgroundUnavailableReason | null {
  if (runtime.backgroundLocationAvailable) {
    return null;
  }
  return runtime.isExpoGo ? 'expo-go' : 'platform';
}

/**
 * Derives the runtime description from injected facts. Pure: the same facts
 * always give the same description, and nothing here touches a native
 * module.
 */
export function describeRuntime(facts: RuntimeEnvironmentFacts): RuntimeEnvironment {
  const isExpoGo = isExpoGoEnvironment(facts);
  const isAndroid = facts.platform === 'android';
  return {
    isExpoGo,
    platform: facts.platform,
    googleMapsAvailable: !(isExpoGo && isAndroid),
    backgroundLocationAvailable: !isExpoGo,
    remotePushAvailable: !isExpoGo,
  };
}

/**
 * Facts registered by `runtime-env.ts` (or by a simulation). `null` before
 * registration — outside a React Native runtime (plain Node, web tests) —
 * where the neutral reading "not Expo Go" is the safe one: it never disables
 * a capability that a native build would have.
 */
let registeredFacts: RuntimeEnvironmentFacts | null = null;

const UNREGISTERED_FACTS: RuntimeEnvironmentFacts = {
  executionEnvironment: null,
  appOwnership: null,
  platform: 'unknown',
};

/**
 * Injects the runtime facts. Called once from the side-effect module
 * `runtime-env.ts` (which reads `expo-constants` exactly once, mirroring
 * `services/api-env.ts`); simulations may call it again to switch scenarios.
 */
export function registerRuntimeFacts(facts: RuntimeEnvironmentFacts): void {
  registeredFacts = { ...facts };
}

/**
 * The current runtime description. Thin on purpose: reads the registered
 * facts (registered from `expo-constants` at startup) and derives the
 * capabilities. Safe to call from a render — no I/O, no allocation beyond
 * one small object.
 */
export function getRuntime(): RuntimeEnvironment {
  return describeRuntime(registeredFacts ?? UNREGISTERED_FACTS);
}

/** Test seam: back to the unregistered (neutral) state. */
export function __resetRuntimeEnvironmentForTests(): void {
  registeredFacts = null;
}
