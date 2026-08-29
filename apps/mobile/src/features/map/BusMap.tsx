import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, borderRadius } from '@school-bus-tracking/design-tokens';
import { formatSpeedKmh, formatTime } from '../../lib/format';
import type { LiveFix } from '../tracking/useLiveTripTracking';

/**
 * Native live-tracking map (parent tracking + admin trip detail).
 *
 * Positions are exclusively: the route's stops (from the API) and the live /
 * latest GPS fix streamed over the existing Socket.IO namespace. There is no
 * simulation, interpolation or fallback position in this component — when no
 * fix exists yet, the map simply centres on the route.
 */
export interface BusMapProps {
  stops: StopResponse[];
  fix: LiveFix | null;
  height?: number;
  busTitle?: string;
}

function regionFor(stops: StopResponse[], fix: LiveFix | null): Region | null {
  const points = [
    ...stops
      .filter((stop) => stop.latitude !== null && stop.longitude !== null)
      .map((stop) => ({ latitude: stop.latitude as number, longitude: stop.longitude as number })),
    ...(fix ? [{ latitude: fix.latitude, longitude: fix.longitude }] : []),
  ];
  if (points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return { ...points[0], latitudeDelta: 0.02, longitudeDelta: 0.02 };
  }
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.01, (maxLat - minLat) * 1.4),
    longitudeDelta: Math.max(0.01, (maxLng - minLng) * 1.4),
  };
}

export const BusMap: React.FC<BusMapProps> = ({ stops, fix, height = 260, busTitle = 'Bus' }) => {
  const region = useMemo(() => regionFor(stops, fix), [stops, fix]);
  const routeCoordinates = useMemo(
    () =>
      stops
        .filter((stop) => stop.latitude !== null && stop.longitude !== null)
        .map((stop) => ({
          latitude: stop.latitude as number,
          longitude: stop.longitude as number,
        })),
    [stops],
  );

  if (!region) {
    return <View style={[styles.placeholder, { height }]} />;
  }

  return (
    <View style={[styles.wrap, { height }]}>
      <MapView
        style={styles.map}
        initialRegion={region}
        region={region}
        showsUserLocation={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {routeCoordinates.length > 1 ? (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor={colors.primary[600]}
            strokeWidth={3}
            lineDashPattern={Platform.OS === 'ios' ? [4, 4] : undefined}
          />
        ) : null}

        {stops.map((stop) =>
          stop.latitude !== null && stop.longitude !== null ? (
            <Marker
              key={stop.id}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              title={stop.name}
              description={`Stop ${stop.sequence_number}${stop.address ? ` · ${stop.address}` : ''}`}
              pinColor={colors.neutral[700]}
              tracksViewChanges={false}
            />
          ) : null,
        )}

        {fix ? (
          <Marker
            coordinate={{ latitude: fix.latitude, longitude: fix.longitude }}
            title={busTitle}
            description={`${formatSpeedKmh(fix.speed)} · ${formatTime(fix.recorded_at)}`}
            pinColor={colors.primary[500]}
            tracksViewChanges={false}
          />
        ) : null}
      </MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  placeholder: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[100],
  },
});
