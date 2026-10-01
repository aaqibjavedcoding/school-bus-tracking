'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createDroppedFrameGuard,
  defaultMapDimensionForRole,
  effectiveMapDimension,
  type MapDimension,
  type MapFallbackReason,
} from '@school-bus-tracking/map-assets';
import { loadMapCameraPreference, saveMapCameraPreference } from './map-camera-preferences';

const shownFallbackNotices = new Set<string>();

function consumeFallbackNotice(userId: string | null, reason: MapFallbackReason): boolean {
  const key = `${userId ?? 'anonymous'}:${reason}`;
  if (shownFallbackNotices.has(key)) return false;
  shownFallbackNotices.add(key);
  return true;
}

export interface WebMapCameraModeState {
  dimension: MapDimension;
  threeDUnavailable: boolean;
  fallbackNotice: MapFallbackReason | null;
  setPreferredDimension: (dimension: MapDimension) => void;
  recordRenderFrame: (timestampMs: number) => void;
}

/** Browser-local, per-account camera preference with accessibility/perf guards. */
export function useMapCameraMode(options: {
  userId: string | null;
  role: string | null;
  reducedMotion: boolean;
}): WebMapCameraModeState {
  const { userId, role, reducedMotion } = options;
  const roleDefault = defaultMapDimensionForRole(role);
  const [preferredDimension, setPreferredState] = useState<MapDimension>(roleDefault);
  const [performanceFallback, setPerformanceFallback] = useState(false);
  const [fallbackNotice, setFallbackNotice] = useState<MapFallbackReason | null>(null);
  const frameGuardRef = useRef(createDroppedFrameGuard());
  const dimension = effectiveMapDimension(preferredDimension, reducedMotion, performanceFallback);
  const dimensionRef = useRef(dimension);
  dimensionRef.current = dimension;

  useEffect(() => {
    setPreferredState(roleDefault);
    setPerformanceFallback(false);
    setFallbackNotice(null);
    frameGuardRef.current.reset();
    if (!userId || typeof window === 'undefined') return;
    const stored = loadMapCameraPreference(window.localStorage, userId);
    if (stored) setPreferredState(stored);
  }, [roleDefault, userId]);

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
        setPerformanceFallback(false);
        setFallbackNotice(null);
        frameGuardRef.current.reset();
      }
      if (!userId || typeof window === 'undefined') return;
      saveMapCameraPreference(window.localStorage, userId, next);
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
    threeDUnavailable: reducedMotion || performanceFallback,
    fallbackNotice,
    setPreferredDimension,
    recordRenderFrame,
  };
}
