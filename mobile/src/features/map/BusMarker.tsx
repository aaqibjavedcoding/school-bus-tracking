import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { BusMarkerGraphic } from './BusMarkerGraphic';
import { useBusMarkerMotion, type RenderedMarker } from './useBusMarkerMotion';
import type { BusMotionFix } from './bus-motion.ts';

/**
 * The bus marker — a leaf component, and the **only** thing that re-renders per
 * animation frame.
 *
 * Keeping the ~20 fps state inside a component that renders a single `<Marker>`
 * is what stops per-frame movement from re-rendering the tracking screen: the
 * parent's `<MapView>`, its polyline and its stop markers never see these
 * updates.
 *
 * ### Rotation, per provider (verified against react-native-maps 1.27.2)
 *
 * - **Android** — always Google Maps. `Marker.rotation` maps to
 *   `marker.setRotation(...)` (`MapMarker.java:247`), which rotates the marker
 *   bitmap natively, so the child view stays static and
 *   `tracksViewChanges={false}` holds.
 * - **iOS** — Apple Maps by default (the app injects a Google key for Android
 *   only), and `MapMarkerProps.rotation` is documented *"iOS: Google Maps
 *   only"*. So iOS rotates the child view with a `transform` instead, which
 *   works on Apple Maps *and* on Google Maps if the provider ever changes.
 *
 * Both paths anchor at the vehicle centre: `anchor {0.5, 0.5}` (Google) and
 * `centerOffset {0, 0}` (Apple Maps, `AIRMapMarker.m:138`), which is what makes
 * the rotation happen *around* the GPS coordinate rather than swinging the
 * marker off it.
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
  title: string;
  description: string;
  onFrame?: (marker: RenderedMarker) => void;
}

export const BusMarker: React.FC<BusMarkerProps> = ({
  fix,
  tripId,
  reducedMotion,
  animate,
  title,
  description,
  onFrame,
}) => {
  const marker = useBusMarkerMotion({ fix, tripId, reducedMotion, animate, onFrame });

  // Android snapshots the child view into a bitmap. One frame of tracking is
  // enough to capture it; leaving it on would re-snapshot a static view
  // forever, which is the classic low-end-Android marker performance bug.
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setTracksViewChanges(false));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!marker) {
    return null;
  }

  const heading = marker.headingDeg ?? 0;
  const useNativeRotation = Platform.OS === 'android';

  return (
    <Marker
      coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
      rotation={useNativeRotation ? heading : undefined}
      anchor={{ x: 0.5, y: 0.5 }}
      centerOffset={{ x: 0, y: 0 }}
      tracksViewChanges={tracksViewChanges}
      zIndex={2}
      title={title}
      description={description}
    >
      <View
        style={
          useNativeRotation ? styles.staticGraphic : { transform: [{ rotate: `${heading}deg` }] }
        }
      >
        <BusMarkerGraphic />
      </View>
    </Marker>
  );
};

const styles = StyleSheet.create({
  staticGraphic: {
    // The native `rotation` prop does the turning; the view itself never changes.
    transform: [{ rotate: '0deg' }],
  },
});
