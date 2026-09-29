/**
 * BusMarkerGraphic.tsx — the visual school-bus marker.
 *
 * Renders the bundled `assets/bus-marker.png` sprite: a top-down,
 * 3D-render-style school bus with the windshield on the nose end, nose-up,
 * cut out on a transparent background, and hand-downsampled into
 * @1x/@2x/@3x files (26×42 / 52×84 / 78×126 px — exactly the dp box below,
 * so nothing them resamples at render time, and cheap mdpi phones get a
 * crisp 26 px file instead of decoding a big one). RN picks the density
 * file automatically from the single `require`.
 *
 * Deep-fix R4 replaced the previous drawn-view bus: at map scale a few
 * 5 px strips never read as a vehicle, which was part of why a wandering
 * marker read as "a drifting speck" instead of "GPS noise on a bus". The
 * sprite keeps every earlier property that made heading meaningful:
 *
 * - the image **points up** (nose at the top), so heading 0° is no rotation;
 * - the box is still the square that circumscribes the 26 × 42 footprint,
 *   so the annotation frame never grows or jitters while the bus spins
 *   (still the same `BUS_MARKER_ROTATION_BOX` anchor maths);
 * - the graphic stays **decorative for screen readers**: the Marker and the
 *   status card carry the information, the image says nothing on its own.
 *
 * Stops stay deliberately different: flat, slate, un-rotating dots
 * (`StopMarker`), so a stop can never be mistaken for the bus.
 * The sprite has no network request and adds no new dependency — it is a
 * bundled asset, keeping the zero-new-native-deps rule.
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';

/** Marker footprint, in dp. Exported so the anchor maths stays honest. */
export const BUS_MARKER_WIDTH = 26;
export const BUS_MARKER_HEIGHT = 42;

/**
 * The square the marker needs **room to turn inside**, in dp: the diagonal of
 * the footprint, rounded up.
 *
 * A 26 × 42 bus rotated by 45° occupies about 48 × 48 dp. React Native lays a
 * child out inside its parent's bounds and clips at those bounds on Android, and
 * the annotation bitmap Android captures is exactly the child's measured frame —
 * so giving the marker a box the size of its own unrotated footprint shaves the
 * corners off the bus at every diagonal heading. The marker view is therefore
 * sized to this square and the graphic is centred inside it.
 */
export const BUS_MARKER_ROTATION_BOX = Math.ceil(
  Math.hypot(BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT),
);

export const BusMarkerGraphic: React.FC<{ width?: number; height?: number }> = ({
  width = BUS_MARKER_WIDTH,
  height = BUS_MARKER_HEIGHT,
}) => (
  <View
    pointerEvents="none"
    // The marker is decoration: its information is carried by the callout and
    // by the screen-reader text in the status card below the map, so a screen
    // reader must not be handed the image.
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[styles.frame, { width, height, borderRadius: width / 2 }]}
  >
    <Image
      // Metro needs the literal path inline to bundle the asset; the repo
      // uses the same disable for its other CommonJS requires.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../../assets/bus-marker.png')}
      style={[styles.image, { width, height }]}
      resizeMode="contain"
    />
  </View>
);

const styles = StyleSheet.create({
  // A soft light ellipse under the sprite: the PNG already carries a dark
  // outline for light tiles, and this keeps it readable on dark tiles too,
  // matching the stops' inner-ring approach. Translucent keep-in-sync with
  // `colors.neutral[50]` (#f8fafc).
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(248, 250, 252, 0.65)',
    elevation: 3,
    shadowColor: colors.neutral[900],
    shadowOpacity: 0.3,
    shadowRadius: 3,
  },
  // The default image frame is exactly the pinned box: a 26 x 42 asset at
  // 26 x 42 dp means RN never resamples at render time on any density.
  image: {
    width: BUS_MARKER_WIDTH,
    height: BUS_MARKER_HEIGHT,
  },
});
