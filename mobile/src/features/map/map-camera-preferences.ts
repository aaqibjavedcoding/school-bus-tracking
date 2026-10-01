import AsyncStorage from '@react-native-async-storage/async-storage';
import { parseMapDimension, type MapDimension } from '@school-bus-tracking/map-assets';

/** Existing app preference store (AsyncStorage), scoped to the signed-in user. */
export const MAP_CAMERA_STORAGE_PREFIX = 'sbt.mobile.map-camera.v1';

export function mapCameraStorageKey(userId: string): string {
  return `${MAP_CAMERA_STORAGE_PREFIX}:${userId}`;
}

export async function loadMapDimension(userId: string): Promise<MapDimension | null> {
  try {
    return parseMapDimension(await AsyncStorage.getItem(mapCameraStorageKey(userId)));
  } catch {
    return null;
  }
}

export async function saveMapDimension(userId: string, dimension: MapDimension): Promise<void> {
  try {
    await AsyncStorage.setItem(mapCameraStorageKey(userId), dimension);
  } catch {
    // Preference persistence must never make a map control feel unresponsive.
  }
}
