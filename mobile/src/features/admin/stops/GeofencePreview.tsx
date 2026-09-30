import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';

/** The warning that sits under the radius input on every stop form. */
export const GEOFENCE_RADIUS_HELP = 'Smaller than ~20 m may never trigger on a phone';

/** Side of the preview square, in dp. */
const SIZE = 150;
/** Metres represented by half the preview square — the preview's "zoom". */
const HALF_SPAN_METERS = 120;

/**
 * A live, to-scale preview of the stop's geofence as the radius is typed.
 *
 * Deliberately NOT a tile map (see the web twin): the admin is answering a
 * scale question, so a 20 m grid with a dashed ring and a solid centre dot
 * answers it without pulling the map engine, a tile provider or a network
 * request per keystroke into a form screen. The visual language matches the
 * driver's map: dashed ring = the zone edge, solid dot = the surveyed stop.
 */
export const GeofencePreview: React.FC<{ radiusMeters: number | null }> = ({ radiusMeters }) => {
  const valid = radiusMeters !== null && Number.isFinite(radiusMeters) && radiusMeters > 0;
  const metersPerDp = HALF_SPAN_METERS / (SIZE / 2);
  const rawRadiusDp = valid ? (radiusMeters as number) / metersPerDp : 0;
  const radiusDp = Math.min(rawRadiusDp, SIZE / 2 - 2);
  const clamped = rawRadiusDp > SIZE / 2 - 2;
  const gridStepDp = 20 / metersPerDp;
  const gridLines = Math.floor(SIZE / gridStepDp);

  return (
    <View style={styles.wrap}>
      <View
        style={styles.canvas}
        accessibilityRole="image"
        accessibilityLabel={
          valid
            ? `Geofence preview: ${Math.round(radiusMeters as number)} metre radius, 20 metre grid`
            : 'Geofence preview: no radius set'
        }
      >
        {Array.from({ length: gridLines }, (_, index) => (
          <View key={`v${index}`} style={[styles.gridV, { left: (index + 1) * gridStepDp }]} />
        ))}
        {Array.from({ length: gridLines }, (_, index) => (
          <View key={`h${index}`} style={[styles.gridH, { top: (index + 1) * gridStepDp }]} />
        ))}
        {valid ? (
          <View
            style={[
              styles.ring,
              {
                width: radiusDp * 2,
                height: radiusDp * 2,
                borderRadius: radiusDp,
                left: SIZE / 2 - radiusDp,
                top: SIZE / 2 - radiusDp,
              },
            ]}
          />
        ) : null}
        <View style={styles.centerDot} />
      </View>
      <Text style={styles.caption}>
        {valid
          ? `${Math.round(radiusMeters as number)} m radius · grid squares are 20 m${
              clamped ? ' (ring clipped to fit)' : ''
            }`
          : 'Enter a radius to preview the zone'}
      </Text>
    </View>
  );
};

const RING_COLOR = 'rgb(180, 83, 9)';

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  canvas: {
    width: SIZE,
    height: SIZE,
    backgroundColor: colors.neutral[50],
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: 8,
    overflow: 'hidden',
  },
  gridV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: colors.neutral[200],
  },
  gridH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.neutral[200],
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.5,
    borderColor: RING_COLOR,
    borderStyle: 'dashed',
    opacity: 0.75,
  },
  centerDot: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
    left: SIZE / 2 - 3.5,
    top: SIZE / 2 - 3.5,
    backgroundColor: RING_COLOR,
  },
  caption: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
});
