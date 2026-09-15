const STUBBED = new Set([
  'expo',
  'expo-notifications',
  'expo-router',
  'react-native',
  // Phase 3b: the crew feedback simulation (`crew-feedback.sim.spec.ts`) mocks
  // these two Expo modules plus AsyncStorage, so the real native entry points
  // are never loaded under `node --test`.
  'expo-speech',
  'expo-haptics',
  '@react-native-async-storage/async-storage',
]);
const STUB_URL = new URL('./native-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (STUBBED.has(specifier)) {
    // Distinct URL per package so each can be mocked independently.
    //
    // The specifier is URI-encoded on purpose: `mock.module()` keys its
    // registry by this URL, and a scoped name left raw puts a `/` in the
    // query, which silently stops the mock from matching — the spec then
    // imports the empty stub instead of its fake and fails with "does not
    // provide an export named 'default'". Verified against
    // `@react-native-async-storage/async-storage` (Phase 3b).
    return {
      url: `${STUB_URL}?pkg=${encodeURIComponent(specifier)}`,
      shortCircuit: true,
      format: 'module',
    };
  }
  return nextResolve(specifier, context);
}
