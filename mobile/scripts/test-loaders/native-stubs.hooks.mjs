const STUBBED = new Set(['expo', 'expo-notifications', 'expo-router', 'react-native']);
const STUB_URL = new URL('./native-stub.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (STUBBED.has(specifier)) {
    // Distinct URL per package so each can be mocked independently.
    return { url: `${STUB_URL}?pkg=${specifier}`, shortCircuit: true, format: 'module' };
  }
  return nextResolve(specifier, context);
}
