import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerRuntimeFacts } from './runtime-environment.ts';

/**
 * Bridges the native runtime facts — where the JS bundle runs and on which
 * platform — into the pure `./runtime-environment` module, exactly the way
 * `services/api-env.ts` bridges the Metro dev host into `services/api.ts`.
 *
 * Side effect only: it reads `expo-constants` **once**, when this module is
 * first evaluated (at app start or when the headless background task
 * re-launches the bundle), and registers the facts. Import it from any module
 * that needs `getRuntime()` before first use — the tracking lifecycle does it
 * next to its `api-env.ts` import, and the map components do it themselves.
 *
 * Why the split: `runtime-environment.ts` must stay loadable under plain
 * `node --test` (no Jest/Vitest in this repo), and `expo-constants` cannot
 * be imported there — same reason `api.ts` is kept free of `expo-constants`.
 */
registerRuntimeFacts({
  executionEnvironment: Constants.executionEnvironment ?? null,
  appOwnership: Constants.appOwnership ?? null,
  platform: Platform.OS,
});
