/**
 * Keyed, device-protected storage for the mobile session.
 *
 * Tokens never live in `AsyncStorage` (which is plaintext on disk): the
 * refresh token goes to `expo-secure-store` (Keychain on iOS, hardware
 * Keystore/EncryptedSharedPreferences on Android), and the short-lived
 * access token is mirrored there only so a cold-started background GPS task
 * can rehydrate without an interactive login.
 *
 * A small in-memory map keeps reads synchronous for hot paths (request
 * signing, socket handshakes), and the whole module degrades to memory-only
 * where SecureStore is unavailable (unit tests, web preview), which keeps the
 * auth layer testable without a device.
 */

import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type SessionKey =
  'access_token' | 'refresh_token' | 'expires_at' | 'user' | 'gps_active_trip';

export interface KeyValueStorage {
  get(key: SessionKey): string | null;
  set(key: SessionKey, value: string | null): Promise<void> | void;
}

const secureStoreAvailable = Platform.OS === 'ios' || Platform.OS === 'android';

export function createSecureStorage(): KeyValueStorage {
  const memory = new Map<SessionKey, string>();

  const persist = async (key: SessionKey, value: string | null): Promise<void> => {
    if (value === null) {
      memory.delete(key);
    } else {
      memory.set(key, value);
    }
    if (!secureStoreAvailable) {
      return;
    }
    try {
      if (value === null) {
        await SecureStore.deleteItemAsync(`sbt_${key}`);
      } else {
        await SecureStore.setItemAsync(`sbt_${key}`, value);
      }
    } catch {
      // A storage write failure must never break an in-flight request; the
      // in-memory copy keeps the current session usable until the next app
      // launch. (Re-login is the recovery path when the durable copy is gone.)
    }
  };

  const hydrate = (key: SessionKey): string | null => {
    if (memory.has(key)) {
      return memory.get(key) ?? null;
    }
    return null;
  };

  return {
    get: hydrate,
    set: (key, value) => persist(key, value),
  };
}

/** Reads durable state into memory once, on app start (or headless task boot). */
export async function rehydrateStorage(storage: KeyValueStorage): Promise<void> {
  if (!secureStoreAvailable) {
    return;
  }
  const keys: SessionKey[] = [
    'access_token',
    'refresh_token',
    'expires_at',
    'user',
    'gps_active_trip',
  ];
  await Promise.all(
    keys.map(async (key) => {
      try {
        const value = await SecureStore.getItemAsync(`sbt_${key}`);
        if (value !== null && value !== undefined) {
          await storage.set(key, value);
        }
      } catch {
        // Treat an unreadable key as absent — the session flow degrades to
        // "anonymous" rather than crashing at boot.
      }
    }),
  );
}
