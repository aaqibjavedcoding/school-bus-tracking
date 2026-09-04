import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import type { TripResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { Badge, Banner, Button } from '../../components';
import { formatRelative } from '../../lib/format';
import { gpsSignalTier } from '../../lib/geo';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import type { CrewLocationSharing } from './useCrewLocationSharing';

/**
 * GPS sharing panel of the shared crew trip screen.
 *
 * Shows the real state of native location sharing: OS permissions, the
 * foreground watch, the background task, the last device fix (with its
 * accuracy and age), what the server accepted or rejected, and device
 * connectivity. Nothing is inferred or simulated — when nothing has been
 * sent yet, it says so.
 */
export const GpsSharePanel: React.FC<{
  trip: TripResponse;
  sharing: CrewLocationSharing;
}> = ({ trip, sharing }) => {
  const network = useNetworkStatus();
  const { stats } = sharing;

  const lastFixAge = stats.lastFix
    ? Date.now() - new Date(stats.lastFix.recorded_at).getTime()
    : null;
  const tier = gpsSignalTier(lastFixAge, stats.lastFix?.accuracy ?? null);
  const tierLabel = tier === 'good' ? 'GPS good' : tier === 'weak' ? 'GPS weak' : 'GPS stale';
  const tierTone = tier === 'good' ? 'success' : tier === 'weak' ? 'warning' : 'neutral';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Live GPS sharing</Text>
        <Badge
          tone={sharing.sharing ? 'success' : 'neutral'}
          label={sharing.sharing ? 'Sharing' : 'Off'}
        />
      </View>

      {!sharing.canShare ? (
        <Text style={styles.muted}>
          GPS is accepted once the trip is boarding or in progress. Current status:{' '}
          {trip.status.toLowerCase().replace('_', ' ')}.
        </Text>
      ) : (
        <View style={styles.buttonRow}>
          {!sharing.sharing ? (
            <Button
              label="Share GPS"
              onPress={() => void sharing.startSharing()}
              busy={sharing.busy}
              disabled={sharing.busy}
            />
          ) : (
            <Button
              label="Stop sharing"
              variant="danger"
              onPress={() => void sharing.stopSharing()}
              busy={sharing.busy}
              disabled={sharing.busy}
            />
          )}
        </View>
      )}

      {sharing.sharing || sharing.backgroundActive ? (
        <View style={styles.backgroundRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.backgroundTitle}>Keep sharing in background</Text>
            <Text style={styles.mutedSmall}>
              {sharing.backgroundActive
                ? 'Device location runs as a background task while the screen is off.'
                : sharing.backgroundPermission === 'granted'
                  ? 'Allowed — enable to keep sending fixes with the screen off.'
                  : 'Requires “Allow all the time” location permission.'}
            </Text>
          </View>
          <Switch
            value={sharing.backgroundActive}
            disabled={
              sharing.busy ||
              sharing.backgroundPermission === 'unavailable' ||
              (!sharing.sharing && !sharing.backgroundActive)
            }
            onValueChange={(value) =>
              void (value ? sharing.enableBackground() : sharing.disableBackground())
            }
            trackColor={{ true: colors.secondary[500], false: colors.neutral[300] }}
            thumbColor="#ffffff"
          />
        </View>
      ) : null}

      <View style={styles.chipRow}>
        <Badge tone={tierTone} label={tierLabel} />
        <Badge
          tone={network === 'online' ? 'success' : network === 'offline' ? 'danger' : 'neutral'}
          label={`Network ${network}`}
        />
        <Badge
          tone={sharing.foregroundPermission === 'granted' ? 'success' : 'warning'}
          label={`Location ${sharing.foregroundPermission}`}
        />
      </View>

      <View style={styles.statsGrid}>
        <Stat label="Sent" value={String(stats.emittedCount)} />
        <Stat label="Rejected" value={String(stats.rejectedCount)} />
        <Stat label="Dropped (offline)" value={String(stats.disconnectedCount)} />
        <Stat label="Invalid fix" value={String(stats.invalidCount)} />
      </View>

      <Text style={styles.mutedSmall}>
        {stats.lastFix
          ? `Last fix ${formatRelative(stats.lastFix.recorded_at)}${
              stats.lastFix.accuracy !== null ? ` · ±${Math.round(stats.lastFix.accuracy)} m` : ''
            }`
          : 'No fix from this device yet.'}
        {stats.lastReason ? ` · Server said: ${stats.lastReason}` : ''}
      </Text>

      {sharing.message ? (
        <Banner
          tone={
            sharing.message.includes('required') || sharing.message.includes('Allow')
              ? 'warning'
              : 'info'
          }
          message={sharing.message}
        />
      ) : null}
    </View>
  );
};

const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  muted: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
  mutedSmall: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
  },
  buttonRow: {
    gap: spacing.sm,
  },
  backgroundRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.sm + 2,
  },
  backgroundTitle: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[800],
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  stat: {
    flex: 1,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    alignItems: 'center',
  },
  statValue: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  statLabel: {
    fontSize: 11,
    color: colors.neutral[500],
  },
});
