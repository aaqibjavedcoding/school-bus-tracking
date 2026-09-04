import React from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StopResponse, TripResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { Button, Card } from '../../components';
import { buildNavigationUrl, formatCoordinate } from '../../lib/navigation';
import { navigationTargetOf, pickNextStop } from './navigation-stop';

/**
 * Driver navigation to the next stop (Task 44).
 *
 * The platform has no routing service of its own and adding a paid directions
 * API is out of scope, so this is a **hand-off**: the card shows the stop the
 * server computed as next and opens it in the phone's own map application with
 * a plain maps URL. No key, no account, nothing leaves the device beyond the
 * destination the driver can already see.
 *
 * A stop that has not been geofenced yet simply has no Navigate button — the
 * app never sends anyone to a guessed coordinate.
 */

export interface TripNavigationCardProps {
  trip: TripResponse;
  /** Ordered stops of the trip's route. */
  stops: StopResponse[];
  /** Stop id the server currently reports as next, when known. */
  nextStopId?: string | null;
}

export const TripNavigationCard: React.FC<TripNavigationCardProps> = ({
  trip,
  stops,
  nextStopId,
}) => {
  const next = pickNextStop(stops, nextStopId);
  const target = next ? navigationTargetOf(next) : null;
  const url = target ? buildNavigationUrl(target) : null;

  return (
    <Card title="Navigate" description="Opens the next stop in your phone's map app.">
      {next && target ? (
        <>
          <View style={styles.row}>
            <Ionicons name="navigate" size={18} color={colors.primary[600]} />
            <Text style={styles.stopName}>{next.name}</Text>
          </View>
          <Text style={styles.muted}>{formatCoordinate(target.latitude, target.longitude)}</Text>
          {url ? (
            <Button
              label="Navigate to stop"
              onPress={() => void Linking.openURL(url)}
              style={styles.action}
            />
          ) : null}
          <Text style={styles.muted}>
            Trip {trip.id.slice(0, 8)} · {stops.length} stop{stops.length === 1 ? '' : 's'} on this
            route.
          </Text>
        </>
      ) : (
        <Text style={styles.muted}>
          {stops.length === 0
            ? 'No stops on this route yet.'
            : 'This route has no geofenced stops yet — ask the school to add coordinates.'}
        </Text>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stopName: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  muted: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
    borderRadius: borderRadius.md,
  },
});
