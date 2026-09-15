import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SoundSettings } from './crew-feedback.ts';

/**
 * Persistence for the "Sound & vibration" switches.
 *
 * Deliberately the **same pattern as Phase 3a's `lib/i18n-preferences.ts`**,
 * not a new mechanism: one AsyncStorage key, a read that can never throw, a
 * write that is fire-and-forget. The parse/serialise pair below is pure, so
 * `crew-feedback.spec.ts` covers the corrupt-value cases without a device.
 *
 * Why a single JSON key rather than two booleans: the two switches are always
 * read and written together (cold start applies both, the Help screen toggles
 * one and saves the pair), and one key means a half-written preference is not
 * a reachable state.
 */

/** AsyncStorage key of the saved sound preferences. */
export const SOUND_STORAGE_KEY = 'sbt.mobile.sound';

/**
 * Parse a stored value into settings, or `null` when it is absent, corrupt or
 * not the shape we wrote. `null` means "fall through to the role default" —
 * exactly how an unreadable locale falls through to the resolution order.
 */
export function parseSoundSettings(raw: string | null | undefined): SoundSettings | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { voice, vibration } = parsed as Partial<Record<keyof SoundSettings, unknown>>;
    if (typeof voice !== 'boolean' || typeof vibration !== 'boolean') return null;
    return { voice, vibration };
  } catch {
    return null;
  }
}

export function serializeSoundSettings(settings: SoundSettings): string {
  return JSON.stringify({ voice: settings.voice, vibration: settings.vibration });
}

/** The saved preferences, or `null` when unset/unreadable. */
export async function loadSoundSettings(): Promise<SoundSettings | null> {
  try {
    return parseSoundSettings(await AsyncStorage.getItem(SOUND_STORAGE_KEY));
  } catch {
    // An unreadable preference must never block boot — the role default wins.
    return null;
  }
}

/**
 * Persist an explicit choice. Never awaited by the UI: a failed write must
 * not leave the toggle looking un-pressed (same rule as `persistLocale`).
 */
export async function saveSoundSettings(settings: SoundSettings): Promise<void> {
  try {
    await AsyncStorage.setItem(SOUND_STORAGE_KEY, serializeSoundSettings(settings));
  } catch {
    // Non-fatal: the in-memory switch already happened.
  }
}
