import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  parseStoredProfilePhoto,
  profilePhotoStorageKey,
  serializeStoredProfilePhoto,
  type StoredProfilePhoto,
} from './profile-photo.ts';

/**
 * The device's memory of the profile photo it set.
 *
 * Same pattern as `feedback-preferences.ts` and `lib/i18n-preferences.ts`:
 * this file is the only one that touches AsyncStorage, the parse/serialise
 * pair it uses is pure and spec'd in `profile-photo.ts`, reads can never
 * throw, and writes are fire-and-forget — a failed write must not make a
 * photo the server already accepted look unsaved.
 *
 * Why it exists at all: Phase 2A's photo API is write-only, so there is
 * nothing to fetch on a cold start (see the module note in `profile-photo.ts`).
 * The mirror is keyed per user id, so two crew members sharing a phone never
 * see each other's face on the card.
 */

/** The photo this device set for `userId`, or `null` when there is none. */
export async function loadProfilePhoto(userId: string): Promise<StoredProfilePhoto | null> {
  try {
    return parseStoredProfilePhoto(await AsyncStorage.getItem(profilePhotoStorageKey(userId)));
  } catch {
    // An unreadable mirror is not an error the crew member can act on: the
    // card shows the placeholder and both actions still work.
    return null;
  }
}

/** Remembers a photo the API confirmed. Never awaited by the UI. */
export async function saveProfilePhoto(userId: string, photo: StoredProfilePhoto): Promise<void> {
  try {
    await AsyncStorage.setItem(profilePhotoStorageKey(userId), serializeStoredProfilePhoto(photo));
  } catch {
    // The server is the source of truth; the mirror is a convenience.
  }
}

/** Forgets the photo after a confirmed removal. */
export async function clearStoredProfilePhoto(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(profilePhotoStorageKey(userId));
  } catch {
    // Same reasoning as above: nothing the crew member can do about it.
  }
}
