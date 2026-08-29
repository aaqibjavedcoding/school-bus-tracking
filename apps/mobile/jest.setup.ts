/**
 * Jest setup for the mobile workspace (jest-expo preset).
 *
 * The Expo native modules the app touches are mocked here so unit tests run
 * in plain Node without a device:
 *
 * - `expo-secure-store` — tests that need persistence inject their own fake
 *   storage into the session factory; the module-level mock just prevents the
 *   native-module import from throwing.
 * - `expo-location` / `expo-task-manager` — GPS services are unit-tested
 *   through injected fakes around the pure logic modules, never against the
 *   native layer.
 * - `react-native-svg` — the official mock renders testable host elements.
 */

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  isAvailableAsync: jest.fn(async () => true),
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  requestBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getBackgroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  hasServicesEnabledAsync: jest.fn(async () => true),
  getLastKnownPositionAsync: jest.fn(async () => null),
  startLocationUpdatesAsync: jest.fn(async () => undefined),
  stopLocationUpdatesAsync: jest.fn(async () => undefined),
  LOCATION_TASK_EVENT_LOCATION: 'onLocationUpdate',
  Accuracy: {
    BestForNavigation: -2,
    Best: -1,
    Balanced: 200,
    LowPower: 500,
  },
  ActivityType: {
    AutomotiveNavigation: 1,
    Other: 4,
  },
}));

jest.mock('expo-task-manager', () => {
  const registered = new Map<string, unknown>();
  return {
    defineTask: jest.fn((name: string, executor: unknown) => {
      registered.set(name, executor);
    }),
    isTaskRegisteredAsync: jest.fn(async (name: string) => registered.has(name)),
    getRegisteredTasksAsync: jest.fn(async () => Array.from(registered.keys())),
    unregisterTaskAsync: jest.fn(async () => undefined),
    __registeredTasks: registered,
  };
});

/* eslint-disable @typescript-eslint/no-explicit-any -- type annotations inside a jest.mock factory break babel's hoist transform */
jest.mock('@react-native-community/netinfo', () => {
  const listeners = new Set<any>();
  return {
    addEventListener: jest.fn((listener: any) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    fetch: jest.fn(async () => ({ isConnected: true, isInternetReachable: true })),
    send: (state: unknown) => listeners.forEach((listener: any) => listener({ current: state })),
    __listeners: listeners,
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */
