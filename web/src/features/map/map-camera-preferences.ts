import { parseMapDimension, type MapDimension } from '@school-bus-tracking/map-assets';

const PREFIX = 'sbt.web.map-camera.v1';

interface CameraPreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function mapCameraPreferenceKey(userId: string): string {
  return `${PREFIX}:${userId}`;
}

export function loadMapCameraPreference(
  storage: CameraPreferenceStorage,
  userId: string,
): MapDimension | null {
  try {
    return parseMapDimension(storage.getItem(mapCameraPreferenceKey(userId)));
  } catch {
    return null;
  }
}

export function saveMapCameraPreference(
  storage: CameraPreferenceStorage,
  userId: string,
  dimension: MapDimension,
): void {
  try {
    storage.setItem(mapCameraPreferenceKey(userId), dimension);
  } catch {
    // Storage may be blocked, full or unavailable in private browsing. Camera
    // selection remains functional for this session without failing the map.
  }
}
