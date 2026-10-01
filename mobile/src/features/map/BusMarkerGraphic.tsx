/**
 * BusMarkerGraphic.tsx — the shared-school-bus sprite host.
 *
 * `@school-bus-tracking/map-assets` owns the only bus drawing: one top-down
 * (roof-view) school bus whose nose points up, so a heading of 0 is north and
 * the annotation's rotation is the vehicle's real bearing. Its build-time SVG
 * is rasterised by `mobile/scripts/generate-assets.mjs` into the exact Metro
 * density files this component requires (26×42 / 52×84 / 78×126 RGBA).
 *
 * The graphic here contains the rotating vehicle only — coachwork plus the
 * baked contact shadow that must turn with it. The *ambient* ground disc, the
 * moving halo and the heading cone live in `BusMarker.tsx`, outside the
 * rotor, so nothing unrotatable spins with the bus.
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { BUS_MARKER_BOX } from '@school-bus-tracking/map-assets';

/** Marker footprint, in dp. Exported so the anchor maths stays honest. */
export const BUS_MARKER_WIDTH = BUS_MARKER_BOX.width;
export const BUS_MARKER_HEIGHT = BUS_MARKER_BOX.height;

/**
 * The square the marker needs room to turn inside. Keep this derivation next to
 * the dimensions: it is intentionally equal to the package's shared geometry,
 * and prevents Android's annotation snapshot clipping diagonal headings.
 */
export const BUS_MARKER_ROTATION_BOX = Math.ceil(Math.hypot(BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT));

if (BUS_MARKER_ROTATION_BOX !== BUS_MARKER_BOX.rotationBox) {
  throw new Error('BUS_MARKER_BOX rotation geometry is inconsistent');
}

export const BusMarkerGraphic: React.FC<{
  width?: number;
  height?: number;
  /** Last-known locations must not read as current, live movement. */
  desaturated?: boolean;
}> = ({ width = BUS_MARKER_WIDTH, height = BUS_MARKER_HEIGHT, desaturated = false }) => (
  <View
    pointerEvents="none"
    // The marker is decoration: its information is carried by the callout and
    // the status card below the map, so a screen reader must not get the image.
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[styles.frame, { width, height }]}
  >
    <Image
      // Metro needs the literal path inline to bundle the density variants.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../../assets/bus-marker.png')}
      style={[styles.image, { width, height }, desaturated ? styles.desaturated : null]}
      resizeMode="contain"
    />
  </View>
);

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The source image is drawn at exactly the pinned dp box, so RN selects the
  // matching @1x/@2x/@3x asset without runtime resampling.
  image: {
    width: BUS_MARKER_WIDTH,
    height: BUS_MARKER_HEIGHT,
  },
  // Tinting the transparent source turns the entire coachwork slate instead
  // of merely dimming its amber — a last-known marker is visibly non-live.
  desaturated: {
    opacity: 0.72,
    tintColor: '#64748b',
  },
});
