import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '@school-bus-tracking/design-tokens';

/**
 * The top-view school-bus marker graphic.
 *
 * ### Why it is drawn with `View`s and not an image
 *
 * MapLibre renders custom annotations as React Native child views (rasterised
 * offscreen into a bitmap on Android, live on iOS), so a rotating marker has
 * to be a custom child view on **every** platform — the only lever is a
 * `transform`. Drawing the bus as views keeps **one** implementation for both
 * platforms — no PNG and no second, subtly different drawing. It also needs no
 * asset pipeline, no network request and no new dependency (`react-native-svg`
 * is deliberately not added; see the zero-dependency rule in `src/lib/i18n.ts`).
 *
 * ### Geometry
 *
 * The bus is drawn **nose-up**, so heading 0° points north with no rotation
 * applied, and it is a symmetric rectangle about its own centre, so rotating it
 * about its centre keeps the vehicle centre on the GPS coordinate. Both
 * properties are what make a heading reading on this marker mean something.
 *
 * Stops stay deliberately different: they are flat, slate, un-rotating dots
 * (`StopMarker`), so a stop can never be mistaken for the bus at a glance or
 * in a screenshot.
 */

/** Marker footprint, in dp. Exported so the anchor maths stays honest. */
export const BUS_MARKER_WIDTH = 26;
export const BUS_MARKER_HEIGHT = 42;

export const BusMarkerGraphic: React.FC<{ width?: number; height?: number }> = ({
  width = BUS_MARKER_WIDTH,
  height = BUS_MARKER_HEIGHT,
}) => {
  const scale = width / BUS_MARKER_WIDTH;
  return (
    <View
      pointerEvents="none"
      // The marker is decoration: its information is carried by the callout and
      // by the screen-reader text in the status card below the map, so a
      // screen reader must not be handed a pile of empty nested views here.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.body, { width, height, borderRadius: 7 * scale, borderWidth: 2 * scale }]}
    >
      {/* Windscreen at the top: the "this end is the front" cue. */}
      <View
        style={[
          styles.windscreen,
          { height: 5 * scale, borderRadius: 2 * scale, marginBottom: 2 * scale },
        ]}
      />
      <View style={[styles.windows, { gap: 5 * scale }]}>
        <View style={[styles.strip, { borderRadius: 2 * scale }]} />
        <View style={[styles.strip, { borderRadius: 2 * scale }]} />
      </View>
      {/* Rear: darker, so the two ends are distinguishable even in monochrome. */}
      <View style={[styles.rear, { height: 4 * scale, borderRadius: 2 * scale }]} />
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    // School-bus amber with a near-black outline: the outline, not the fill, is
    // what keeps the marker legible over light *and* dark map tiles.
    backgroundColor: colors.primary[500],
    borderColor: colors.neutral[900],
    padding: 3,
    gap: 2,
  },
  windscreen: {
    backgroundColor: colors.neutral[50],
    opacity: 0.95,
  },
  windows: {
    flex: 1,
    flexDirection: 'row',
  },
  strip: {
    flex: 1,
    backgroundColor: colors.neutral[100],
    opacity: 0.8,
  },
  rear: {
    backgroundColor: colors.primary[800],
  },
});
