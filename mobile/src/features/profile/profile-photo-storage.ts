import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  legacyPhotoCacheKey,
  parseCachedPhoto,
  photoCacheKey,
  serializeCachedPhoto,
} from './profile-photo-source.ts';

/**
 * The device's **offline cache** of a profile photo — not its memory of one.
 *
 * Same pattern as `feedback-preferences.ts` and `lib/i18n-preferences.ts`:
 * this file is the only one that touches AsyncStorage, the parse/serialise
 * pair it uses is pure and spec'd in `profile-photo-source.ts`, reads can
 * never throw, and writes are fire-and-forget.
 *
 * What changed with the read-back: entries are keyed by **storage key**, not
 * by user id, and they hold the bytes (a data URI) rather than a camera-cache
 * path. So a cache entry can only ever describe the photo the server
 * currently says exists, it cannot dangle, and a replaced photo gets a new
 * key rather than overwriting an old face. The server remains the source of
 * truth: the cache only decides what is on screen while a device is offline.
 */

/** The cached bytes for one storage key, or `null`. Never throws. */
export async function loadCachedPhoto(storageKey: string): Promise<string | null> {
  try {
    return parseCachedPhoto(await AsyncStorage.getItem(photoCacheKey(storageKey)));
  } catch {
    // An unreadable cache is not an error anyone can act on: the avatar
    // falls back to the placeholder and the server fetch still runs.
    return null;
  }
}

/** Caches bytes the server returned for a key. Never awaited by the UI. */
export async function saveCachedPhoto(storageKey: string, dataUri: string): Promise<void> {
  try {
    await AsyncStorage.setItem(photoCacheKey(storageKey), serializeCachedPhoto(dataUri));
  } catch {
    // The server is the source of truth; the cache is a convenience.
  }
}

/** Drops the cache entry for a key (a removal, or a superseded photo). */
export async function clearCachedPhoto(storageKey: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(photoCacheKey(storageKey));
  } catch {
    // Same reasoning as above.
  }
}

/**
 * Deletes the pre-read-back mirror for an account.
 *
 * That entry held a raw camera-cache URI that may already be dangling and is
 * never read again; removing it on first run keeps a purged file path from
 * sitting in storage forever.
 */
export async function forgetLegacyPhotoMirror(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(legacyPhotoCacheKey(userId));
  } catch {
    // Best effort — nothing reads it either way.
  }
}
