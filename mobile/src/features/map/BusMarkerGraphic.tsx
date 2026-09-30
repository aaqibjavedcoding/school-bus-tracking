/**
 * BusMarkerGraphic.tsx — the visual school-bus marker.
 *
 * Renders the bundled `assets/bus-marker.png` sprite. That sprite is no longer a
 * hand-cut AI raster: it is rasterised from the ONE shared artwork,
 * `@school-bus-tracking/map-assets` (`BUS_BODY_SVG`), by
 * `scripts/make-bus-marker.mjs` — the exact same markup the web map inlines as
 * SVG. Web and mobile therefore draw the same three-quarter isometric,
 * distinctly 3D school bus; there is no second bus definition to drift.
 *
 * The sprite ships @1x/@2x/@3x (26×42 / 52×84 / 78×126 px — exactly the dp box
 * below, so nothing resamples at render time and cheap mdpi phones decode a
 * crisp 26 px file). RN picks the density file from the single `require`.
 *
 * Every earlier heading/anchor property is kept:
 *
 * - the image **points up** (nose at the top), so heading 0° is no rotation;
 * - the box is the square that circumscribes the 26 × 42 footprint, so the
 *   annotation frame never grows or jitters while the bus spins
 *   (`BUS_MARKER_ROTATION_BOX`);
 * - the graphic stays **decorative for screen readers** — the callout and the
 *   status card carry the information, the image says nothing on its own.
 *
 * The ground shadow and the pulse halo are drawn by `BusMarker`, OUTSIDE the
 * rotating view, so they never spin with the bus.
 *
 * `tone` renders the freshness verdict: `'live'` is full colour; `'stale'`
 * (last-known) mutes the sprite. RN has no CSS `grayscale()` filter without a
 * native dependency, so "desaturated" is approximated with reduced opacity plus
 * a translucent neutral wash — enough to read the amber as faded, in keeping
 * with the zero-new-native-deps rule.
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';

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
export const BUS_MARKER_ROTATION_BOX = Math.ceil(Math.hypot(BUS_MARKER_WIDTH, BUS_MARKER_HEIGHT));

export const BusMarkerGraphic: React.FC<{
  width?: number;
  height?: number;
  /** `'stale'` mutes the sprite for a last-known position. */
  tone?: 'live' | 'stale';
}> = ({ width = BUS_MARKER_WIDTH, height = BUS_MARKER_HEIGHT, tone = 'live' }) => {
  const stale = tone === 'stale';
  return (
    <View
      pointerEvents="none"
      // The marker is decoration: its information is carried by the callout and
      // by the screen-reader text in the status card below the map, so a screen
      // reader must not be handed the image.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.frame, { width, height, opacity: stale ? 0.6 : 1 }]}
    >
      <Image
        // Metro needs the literal path inline to bundle the asset; the repo
        // uses the same disable for its other CommonJS requires.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../../../assets/bus-marker.png')}
        style={[styles.image, { width, height }]}
        resizeMode="contain"
      />
      {stale ? (
        // Neutral wash: RN has no grayscale filter, so a translucent slate
        // overlay approximates the "desaturated / last known" look.
        <View pointerEvents="none" style={[styles.staleWash, { width, height }]} />
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The default image frame is exactly the pinned box: a 26 x 42 asset at
  // 26 x 42 dp means RN never resamples at render time on any density.
  image: {
    width: BUS_MARKER_WIDTH,
    height: BUS_MARKER_HEIGHT,
  },
  staleWash: {
    position: 'absolute',
    backgroundColor: 'rgba(148, 163, 184, 0.45)',
    borderRadius: 6,
  },
});
