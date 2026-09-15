const STUBBED = new Set([
  'expo',
  'expo-notifications',
  'expo-router',
  'react-native',
  // Phase 3b: the voice/haptics simulation mocks these the same way the push
  // simulation mocks expo-notifications — their real entry points cannot be
  // type-stripped under node_modules.
  'expo-speech',
  'expo-haptics',
]);
const STUB_URL = new URL('./native-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (STUBBED.has(specifier)) {
    // Distinct URL per package so each can be mocked independently.
    return { url: `${STUB_URL}?pkg=${specifier}`, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
