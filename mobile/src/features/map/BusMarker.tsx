import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { ViewAnnotation, type ViewAnnotationRef } from '@maplibre/maplibre-react-native';
import { BUS_MARKER_ROTATION_BOX, BusMarkerGraphic } from './BusMarkerGraphic';
import { useBusMarkerMotion, type RenderedMarker } from './useBusMarkerMotion';
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
  const annotationRef = useRef<ViewAnnotationRef | null>(null);
  // The effect must not "refresh" on the very first commit: the initial
  // bitmap is captured by the layout listener when the map adds the
  // annotation, and the map may not be ready yet.
  const hasCommittedRef = useRef(false);

  const heading = marker ? (marker.headingDeg ?? 0) : 0;

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
        <View style={{ transform: [{ rotate: `${heading}deg` }], overflow: 'visible' }}>
          <BusMarkerGraphic />
        </View>
      </View>
    </ViewAnnotation>
  );
};
