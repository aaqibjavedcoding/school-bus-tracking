import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { ViewAnnotation, type ViewAnnotationRef } from '@maplibre/maplibre-react-native';
import { resolveBusMarkerVisualState } from '@school-bus-tracking/map-assets';
import { colors } from '@school-bus-tracking/design-tokens';
import { BUS_MARKER_ROTATION_BOX, BusMarkerGraphic } from './BusMarkerGraphic';
import { useBusMarkerMotion, type RenderedMarker } from './useBusMarkerMotion';
import { createRouteSnapper, type RouteSnapPoint } from './route-snap.ts';
import type { BusMotionFix } from './bus-motion.ts';

/**
 * The bus marker — a leaf component, and the **only** thing that re-renders per
 * animation frame.
 *
 * Keeping the ~20 fps state inside a component that renders a single
 * `<ViewAnnotation>` is what stops per-frame movement from re-rendering the
 * tracking screen: the parent's `<Map>`, its route layer and its stop markers
 * never see these updates.
 *
 * ### Rotation, per platform (verified against @maplibre/maplibre-react-native 11.4.0)
 *
 * MapLibre annotations have no native "rotate the marker" prop — the child
 * view is the marker — so the bus turns with a `transform` on the child view
 * on **both** platforms:
 *
 * - **Android** — the child is rendered offscreen and rasterised into a
 *   bitmap (`MLRNPointAnnotation.kt`). A transform change never triggers a
 *   layout change, so the bitmap is re-captured explicitly: an effect calls
 *   the annotation's `refresh()` whenever the heading actually changes.
 *   Position changes do not touch the bitmap — the symbol's coordinate is
 *   updated natively (`setLngLat`), which is what keeps ~20 fps cheap.
 * - **iOS** — the child view is rendered live; `refresh()` is a no-op there.
 *
 * Both paths anchor at the vehicle centre (`anchor="center"`), which is what
 * makes the rotation happen *around* the GPS coordinate rather than swinging
 * the marker off it.
 *
 * ### Marker states (shared verdict)
 *
 * `resolveBusMarkerVisualState` (from `@school-bus-tracking/map-assets`, the
 * same function the web map calls) turns the freshness verdict, the OS
 * reduce-motion preference and the current speed into three flags:
 *
 * - **tone** — full colour when live, muted when last-known/stale;
 * - **pulse** — a gentle halo that breathes behind the bus while live, off under
 *   reduce-motion and off when stale;
 * - **cone** — a translucent heading cone ahead of the bus, shown only above the
 *   3 km/h heading gate `bus-motion.ts` already enforces.
 *
 * The shadow and the halo sit OUTSIDE the rotating view so they never spin; the
 * cone sits INSIDE it so it always points where the bus is going.
 */
export interface BusMarkerProps {
  /**
   * The newest raw fix, whatever delivered it: the observer socket, or the
   * device's own GPS watcher on the Driver Trip screen. Only the position,
   * heading, speed and timestamp are read here; no prop of this component
   * describes *where the fix came from*, which is deliberately the caller's
   * job (see `crew-map-presentation.ts`).
   */
  fix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  animate: boolean;
  /**
   * The drawn route polyline (stops in order — the same coordinates the map
   * draws its dashed line from). The marker's accepted fixes are projected
   * onto it for DISPLAY, which is the R4 lateral zig-zag fix: the bus tracks
   * the line it drives instead of redrawing every metre of GPS noise. The
   * raw `fix` is untouched, and off-route fixes (detour, depot) are drawn
   * raw — `route-snap.ts` owns both rules.
   */
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
  // One snapper per stops list: projecting is pure math, so the memo is on
  // the route identity and costs nothing between fixes.
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
  // The effect must not "refresh" on the very first commit: the initial
  // bitmap is captured by the layout listener when the map adds the
  // annotation, and the map may not be ready yet.
  const hasCommittedRef = useRef(false);

  const heading = marker ? (marker.headingDeg ?? 0) : 0;

  // The one shared verdict. `animate` is the freshness "may report live motion"
  // flag; speed comes from the raw fix (m/s → km/h) and the heading gate lives
  // in the resolver, so the cone appears exactly when the motion machine trusts
  // the heading.
  const visual = resolveBusMarkerVisualState({
    live: animate,
    reducedMotion,
    speedKmh: fix?.speed != null && Number.isFinite(fix.speed) ? fix.speed * 3.6 : null,
    hasHeading: marker?.headingDeg != null,
  });

  // Gentle pulse halo. Driven imperatively so it never re-renders the tree; it
  // is torn down whenever the verdict says no pulse (stale / reduce-motion).
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!visual.pulse) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1900,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [visual.pulse, pulse]);

  // Android re-captures the offscreen bitmap when the rotation changes — a
  // transform never fires a layout change, so the change has to be announced.
  // iOS renders the child live; `refresh()` is a documented no-op there.
  useEffect(() => {
    if (!hasCommittedRef.current) {
      hasCommittedRef.current = true;
      return;
    }
    annotationRef.current?.refresh();
  }, [heading]);

  if (!marker) {
    return null;
  }

  return (
    <ViewAnnotation
      ref={annotationRef}
      lngLat={[marker.longitude, marker.latitude]}
      anchor="center"
      title={title}
      snippet={description}
    >
      {/*
        Two views, and the split is the whole point: the outer box is square and
        *unrotated*, so the frame Android measures (and rasterises) already
        contains the marker at any heading, while the inner view carries the
        rotation. Rotating the only view would clip the bus to its own unrotated
        26 × 42 footprint and cut the corners off on a diagonal heading.

        The ground shadow and the pulse halo are children of the OUTER box, so
        they stay put while the bus turns.
      */}
      <View
        style={{
          width: BUS_MARKER_ROTATION_BOX,
          height: BUS_MARKER_ROTATION_BOX,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
        }}
      >
        <View
          pointerEvents="none"
          style={[styles.groundShadow, visual.tone === 'stale' && styles.groundShadowStale]}
        />
        {visual.pulse ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.halo,
              {
                opacity: pulse.interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [0.6, 0.12, 0],
                }),
                transform: [
                  {
                    scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.1] }),
                  },
                ],
              },
            ]}
          />
        ) : null}
        <View style={{ transform: [{ rotate: `${heading}deg` }], overflow: 'visible' }}>
          {visual.cone ? <View pointerEvents="none" style={styles.cone} /> : null}
          <BusMarkerGraphic tone={visual.tone} />
        </View>
      </View>
    </ViewAnnotation>
  );
};

const HALO_SIZE = 34;

const styles = StyleSheet.create({
  // Soft elliptical ground shadow — pooled under the bus, nudged down toward the
  // tail. Outside the rotating view, so the light source never orbits the bus.
  groundShadow: {
    position: 'absolute',
    top: BUS_MARKER_ROTATION_BOX / 2 + 6,
    width: 30,
    height: 10,
    borderRadius: 5,
    backgroundColor: 'rgba(15, 23, 42, 0.26)',
  },
  groundShadowStale: {
    opacity: 0.6,
  },
  halo: {
    position: 'absolute',
    width: HALO_SIZE,
    height: HALO_SIZE,
    borderRadius: HALO_SIZE / 2,
    backgroundColor: colors.primary[500],
  },
  // Heading cone: a translucent triangle ahead of (above) the bus, inside the
  // rotating view so it turns with the vehicle.
  cone: {
    position: 'absolute',
    bottom: '100%',
    alignSelf: 'center',
    marginBottom: -4,
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 22,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderBottomColor: 'rgba(245, 158, 11, 0.4)',
  },
});
