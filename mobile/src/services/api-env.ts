import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerApiEnv } from './api.ts';

/**
 * Bridges the native runtime facts — platform and the Metro dev-server host —
 * into the pure `./api` module, so the API base URL auto-resolves to the
 * machine running `expo start` (its LAN IP in most setups). Physical phones
 * in Expo Go then reach the REST API and the Socket.IO namespaces with zero
 * configuration; no env var and no manual IP editing.
 *
 * Side-effect only: import it once from the root layout, before any module
 * that talks to the API.
 */
registerApiEnv({
  dev: __DEV__,
  platform: Platform.OS,
  devHost: Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? null,
});
