import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ViewAnnotation } from '@maplibre/maplibre-react-native';
import { colors } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import type { DriverStopMarkerKind } from '../crew/crew-map-presentation.ts';

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
 *
 * ### `variant` — which stop is next
 *
 * `variant` ('plain' | 'next', mirroring the web map's
 * `createStopMarkerElement` kinds) is presentation only: the **next-stop id
 * arrives as a prop** from the screen's `deriveTripProgressForTrip`
 * derivation (`crew-map-presentation.driverStopMarkerKind` decides the kind),
 * so this component cannot develop a second opinion about progress. `next`
 * renders a bigger amber pin with a NEXT badge chip — the one stop the driver
 * is driving towards must be findable in a glance, not by reading labels.
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
  /** `'next'` gets the big amber pin + NEXT badge; default `'plain'`. */
  variant?: DriverStopMarkerKind;
}

const StopMarkerView: React.FC<StopMarkerProps> = ({
  id,
  latitude,
  longitude,
  title,
  description,
  label,
  variant = 'plain',
}) => {
  const isNext = variant === 'next';
  return (
    <ViewAnnotation
      id={id}
      lngLat={[longitude, latitude]}
      anchor="left"
      title={title}
      snippet={description}
    >
      <View style={styles.row}>
        <View style={isNext ? styles.pinNext : styles.pin} />
        <View style={isNext ? styles.chipNext : styles.chip}>
          {isNext ? (
            <Text style={styles.badgeText} maxFontSizeMultiplier={1.3}>
              {t('map.nextBadge')}
            </Text>
          ) : null}
          <Text
            numberOfLines={1}
            style={isNext ? styles.chipTextNext : styles.chipText}
            maxFontSizeMultiplier={1.3}
          >
            {label}
          </Text>
        </View>
      </View>
    </ViewAnnotation>
  );
};
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
  pinNext: {
    // The one stop being driven to: near-double size, amber (the brand's
    // school-bus colour, also the status-warning hue the ETA list uses for
    // "Next"), white ring kept for contrast on both tile themes.
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.primary[600],
    borderWidth: 3,
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
  chipNext: {
    marginLeft: 6,
    maxWidth: 190,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.96)',
    borderWidth: 2,
    borderColor: colors.primary[600],
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  chipTextNext: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  badgeText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#ffffff',
    backgroundColor: colors.primary[600],
    borderRadius: 6,
    overflow: 'hidden',
    paddingHorizontal: 5,
    paddingVertical: 1,
    letterSpacing: 0.5,
  },
});
