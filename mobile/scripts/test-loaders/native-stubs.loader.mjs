/**
 * Test-only ESM loader: redirects the native-runtime packages the push
 * simulation mocks (`expo`, `expo-notifications`, `expo-router`,
 * `react-native`) to an empty stub so Node never tries to load their real
 * entry points (e.g. `expo/src/Expo.ts`, which cannot be type-stripped under
 * node_modules). The spec then replaces the stubs with `mock.module(...)`.
 */
import { register } from 'node:module';

register(new URL('./native-stubs.hooks.mjs', import.meta.url));
