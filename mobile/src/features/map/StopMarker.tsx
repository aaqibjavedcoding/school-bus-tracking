import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import { colors } from '@school-bus-tracking/design-tokens';

/**
 * A stop pin: a small slate dot.
 *
 * MapLibre has no built-in teardrop pin (that was the platform-provider
 * default), so stops are drawn as a deliberately simple, deliberately
 * *different species* from the bus: a flat, slate, un-rotating dot, so a stop
 * can never be mistaken for the flat, amber, rotating bus — at a glance and
 * in a screenshot.
 *
 * `title` is data (the stop's name) and `description` carries the a11y line
 * (`map.stopA11y` + optional address): on iOS the native default callout
 * shows the title on tap, and the status panel below the map carries the same
 * facts as real text for a screen reader.
 */
export interface StopMarkerProps {
  /** Stable id — doubles as the annotation id. */
  id: string;
  latitude: number;
  longitude: number;
  title: string;
  /** The a11y line, already resolved in the current locale. */
  description: string;
}

const StopMarkerView: React.FC<StopMarkerProps> = ({
  id,
  latitude,
  longitude,
  title,
  description,
}) => (
  <ViewAnnotation
    id={id}
    lngLat={[longitude, latitude]}
    anchor="center"
    title={title}
    snippet={description}
  >
    <View style={styles.pin} />
  </ViewAnnotation>
);
StopMarkerView.displayName = 'StopMarkerView';

export const StopMarker = React.memo(StopMarkerView);

const styles = StyleSheet.create({
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
});
