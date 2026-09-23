import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import { colors } from '@school-bus-tracking/design-tokens';

/**
 * A stop pin: a small slate dot **plus its always-visible name label**.
 *
 * MapLibre has no built-in teardrop pin (that was the platform-provider
 * default), so stops are drawn as a deliberately simple, deliberately
 * *different species* from the bus: a flat, slate, un-rotating dot, so a stop
 * can never be mistaken for the flat, amber, rotating bus — at a glance and
 * in a screenshot.
 *
 * The label ("{number}. {name}" — the shared `map.stopLabel` template, the
 * web map's `.stop-marker-label` twin) is the reading affordance: staff
 * stopped clicking callouts to find out which dot is which. It is a single
 * row [dot, chip] anchored `left` so the dot itself sits on the coordinate;
 * `title`/`description` stay as the callout/a11y data.
 */
export interface StopMarkerProps {
  /** Stable id — doubles as the annotation id. */
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  /** The a11y line, already resolved in the current locale. */
  description: string;
  /** The always-visible label, already resolved (`map.stopLabel`). */
  label: string;
}

const StopMarkerView: React.FC<StopMarkerProps> = ({
  id,
  latitude,
  longitude,
  title,
  description,
  label,
}) => (
  <ViewAnnotation
    id={id}
    lngLat={[longitude, latitude]}
    anchor="left"
    title={title}
    snippet={description}
  >
    <View style={styles.row}>
      <View style={styles.pin} />
      <View style={styles.chip}>
        <Text numberOfLines={1} style={styles.chipText}>
          {label}
        </Text>
      </View>
    </View>
  </ViewAnnotation>
);
StopMarkerView.displayName = 'StopMarkerView';

export const StopMarker = React.memo(StopMarkerView);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  pin: {
    // 10 dp dot with a white ring: legible over both light and dark tiles,
    // and clearly "not a bus".
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.neutral[700],
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  chip: {
    marginLeft: 4,
    maxWidth: 150,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[900],
  },
});
