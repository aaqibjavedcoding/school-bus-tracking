import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { ViewAnnotationRef } from '@maplibre/maplibre-react-native';
import { BUS_MARKER_ROTATION_BOX, BusMarkerGraphic } from './BusMarkerGraphic';
import { useBusMarkerMotion, type RenderedMarker } from './useBusMarkerMotion';
import { createRouteSnapper, type RouteSnapPoint } from './route-snap.ts';
import { MOTION_THRESHOLDS, type BusMotionFix } from './bus-motion.ts';

/** Lazily loads the native annotation module only when a map marker renders. */
type MapLibreModule = typeof import('@maplibre/maplibre-react-native');

function requireMapLibre(): MapLibreModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@maplibre/maplibre-react-native') as MapLibreModule;
}

/**
 * The bus marker — a leaf component, and the only thing that re-renders per
 * animation frame. Its annotation stays centred on the GPS coordinate while a
 * fixed outer turning box prevents Android's raster snapshot from clipping it.
 */
export interface BusMarkerProps {
  fix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  /** Fresh GPS only: stale / last-known positions are frozen and slate. */
  animate: boolean;
  route?: readonly RouteSnapPoint[] | null;
  title: string;
  description: string;
  onFrame?: (marker: RenderedMarker) => void;
}

export const BusMarker: React.FC<BusMarkerProps> = ({
  fix,
  tripId,
  reducedMotion,
  animate,
  route = null,
  title,
  description,
  onFrame,
}) => {
  // BusMarker is only rendered inside the native map branch. Requiring the
  // annotation component here keeps importing the surrounding route tree safe
  // in Expo Go, where the MapLibre native module does not exist.
  const { ViewAnnotation } = requireMapLibre();
  const snapToRoute = useMemo(
    () => (route !== null && route.length >= 2 ? createRouteSnapper(route) : null),
    [route],
  );
  const marker = useBusMarkerMotion({
    fix,
    tripId,
    reducedMotion,
    animate,
    snapToRoute,
    onFrame,
  });
  const annotationRef = useRef<ViewAnnotationRef | null>(null);
  const hasCommittedRef = useRef(false);
  const pulse = useRef(new Animated.Value(0)).current;

  const heading = marker ? (marker.headingDeg ?? 0) : 0;
  // The cone uses the motion module's existing 3 km/h heading gate, rather
  // than inventing a visual-only threshold. A live bus below it is stopped.
  const sourceSpeedKmh = marker?.sourceSpeedKmh ?? null;
  const liveMoving =
    animate &&
    marker?.headingDeg !== null &&
    sourceSpeedKmh !== null &&
    sourceSpeedKmh >= MOTION_THRESHOLDS.headingMinSpeedKmh;
  const showPulse = liveMoving && !reducedMotion;
  const showCone = liveMoving;

  // Android rasterises annotation children. A heading transform is therefore
  // explicitly re-captured; iOS renders it live and treats refresh as a no-op.
  useEffect(() => {
    if (!hasCommittedRef.current) {
      hasCommittedRef.current = true;
      return;
    }
    annotationRef.current?.refresh();
  }, [heading]);

  // A soft live-moving presence halo. It never starts for stopped/stale data,
  // and reduced motion stops it immediately along with the position tween.
  useEffect(() => {
    pulse.stopAnimation();
    pulse.setValue(0);
    if (!showPulse) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, showPulse]);

  if (!marker) return null;

  const pulseStyle = {
    opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.28, 0] }),
    transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.3] }) }],
  };

  return (
    <ViewAnnotation
      ref={annotationRef}
      lngLat={[marker.longitude, marker.latitude]}
      // The GPS coordinate is the marker centre at every heading, never the
      // nose/tail: this is the load-bearing anchor invariant.
      anchor="center"
      title={title}
      snippet={description}
    >
      <View style={styles.rotationBox}>
        {/* The shadow is intentionally outside the rotated bus group. */}
        <View style={[styles.groundShadow, animate ? null : styles.groundShadowStale]} />
        {showPulse ? (
          <Animated.View pointerEvents="none" style={[styles.pulseHalo, pulseStyle]} />
        ) : null}
        <View style={[styles.rotor, { transform: [{ rotate: `${heading}deg` }] }]}>
          {showCone ? <View pointerEvents="none" style={styles.headingCone} /> : null}
          <BusMarkerGraphic desaturated={!animate} />
        </View>
      </View>
    </ViewAnnotation>
  );
};

const styles = StyleSheet.create({
  rotationBox: {
    width: BUS_MARKER_ROTATION_BOX,
    height: BUS_MARKER_ROTATION_BOX,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  rotor: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  groundShadow: {
    position: 'absolute',
    width: 28,
    height: 7,
    borderRadius: 99,
    top: 38,
    backgroundColor: 'rgba(15, 23, 42, 0.25)',
    transform: [{ scaleX: 1.18 }],
  },
  groundShadowStale: {
    opacity: 0.55,
  },
  pulseHalo: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(245, 158, 11, 0.38)',
  },
  headingCone: {
    position: 'absolute',
    top: -14,
    left: 5,
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderBottomWidth: 17,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(37, 99, 235, 0.38)',
  },
});
