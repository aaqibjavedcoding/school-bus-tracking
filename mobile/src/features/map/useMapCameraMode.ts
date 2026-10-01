import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDroppedFrameGuard,
  defaultMapDimensionForRole,
  effectiveMapDimension,
  type MapDimension,
  type MapFallbackReason,
} from '@school-bus-tracking/map-assets';
import { useAuth } from '../auth/AuthProvider';
import { loadMapDimension, saveMapDimension } from './map-camera-preferences.ts';

/** One status notice per account/reason for this app session, across map screens. */
const shownFallbackNotices = new Set<string>();

function consumeFallbackNotice(userId: string | null, reason: MapFallbackReason): boolean {
  const key = `${userId ?? 'anonymous'}:${reason}`;
  if (shownFallbackNotices.has(key)) return false;
  shownFallbackNotices.add(key);
  return true;
}

export interface MapCameraModeState {
  dimension: MapDimension;
  preferredDimension: MapDimension;
  threeDUnavailable: boolean;
  fallbackNotice: MapFallbackReason | null;
  setPreferredDimension: (dimension: MapDimension) => void;
  recordRenderFrame: (timestampMs: number) => void;
}

/**
 * Per-user 2D/3D preference plus accessibility/performance fallbacks.
 * Explicit choices persist; automatic fallbacks are session-local so a slow
 * phone cannot silently rewrite the user's preference for every other device.
 */
export function useMapCameraMode(reducedMotion: boolean): MapCameraModeState {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const role = user?.role ?? null;
  const roleDefault = defaultMapDimensionForRole(role);
  const [preferredDimension, setPreferredState] = useState<MapDimension>(roleDefault);
  const [performanceFallback, setPerformanceFallback] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<MapFallbackReason | null>(null);
  const frameGuardRef = useRef(createDroppedFrameGuard());
  const dimension = effectiveMapDimension(preferredDimension, reducedMotion, performanceFallback);
  const dimensionRef = useRef(dimension);
  dimensionRef.current = dimension;

  useEffect(() => {
    let cancelled = false;
    setPreferredState(roleDefault);
    setPerformanceFallback(false);
    setFallbackNotice(null);
    frameGuardRef.current.reset();
    if (!userId) return undefined;
    void loadMapDimension(userId).then((stored) => {
      if (!cancelled && stored) setPreferredState(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, roleDefault]);

  useEffect(() => {
    if (!reducedMotion || preferredDimension !== '3d') return;
    if (consumeFallbackNotice(userId, 'reduced-motion')) {
      setFallbackNotice('reduced-motion');
    }
  }, [preferredDimension, reducedMotion, userId]);

  useEffect(() => {
    if (dimension !== '3d') frameGuardRef.current.reset();
  }, [dimension]);

  useEffect(() => {
    if (preferredDimension !== '3d' || (!reducedMotion && !performanceFallback)) {
      setFallbackNotice(null);
    }
  }, [performanceFallback, preferredDimension, reducedMotion]);

  const setPreferredDimension = useCallback(
    (next: MapDimension) => {
      setPreferredState(next);
      if (next === '2d') {
        // Tapping the already-active 2D side acknowledges a performance
        // fallback and permits a later explicit 3D retry without another nag.
        setPerformanceFallback(false);
        setFallbackNotice(null);
        frameGuardRef.current.reset();
      }
      if (userId) void saveMapDimension(userId, next);
    },
    [userId],
  );

  const recordRenderFrame = useCallback(
    (timestampMs: number) => {
      if (dimensionRef.current !== '3d') return;
      if (!frameGuardRef.current.sample(timestampMs)) return;
      setPerformanceFallback(true);
      if (consumeFallbackNotice(userId, 'dropped-frames')) {
        setFallbackNotice('dropped-frames');
      }
    },
    [userId],
  );

  return {
    dimension,
    preferredDimension,
    threeDUnavailable: reducedMotion || performanceFallback,
    fallbackNotice,
    setPreferredDimension,
    recordRenderFrame,
  };
}
