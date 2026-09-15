import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { UserRole } from '@school-bus-tracking/shared-types';
import { useAuth } from '../../src/features/auth';
import { GpsSharePanel, useCrewLocationSharing, useCrewToday } from '../../src/features/crew';
import { GpsPermissionRecovery } from '../../src/features/crew/GpsPermissionRecovery';
import { SosStatusLine, useCrewSos } from '../../src/features/crew/SosPanel';
import { crewCopy } from '../../src/features/crew/crew-copy';
import { Card, LoadingView, Screen, SectionTitle } from '../../src/components';

/**
 * Help / Support screen (Phase 2).
 *
 * **The telemetry moved here — nothing was deleted.** The GPS counters the
 * trip screen used to show while driving ("Rejected", "Dropped (offline)",
 * "Invalid fix", raw diagnostics) live here, framed for what they are:
 * numbers the crew reads *with the support team*, after the run or on the
 * phone — never while the bus is moving.
 *
 * Guarded by `src/features/crew/help-routing.spec.ts`: the trip screen must
 * NOT render `GpsSharePanel`, this screen must.
 */
export default function CrewHelpScreen() {
  const { user } = useAuth();
  const { data, loading } = useCrewToday();
  const trip = data?.trip ?? null;
  const sharing = useCrewLocationSharing(trip);
  const sos = useCrewSos(trip?.id ?? null);
  const isDriver = user?.role === UserRole.DRIVER;

  if (loading && !data) {
    return <LoadingView label="Loading help…" />;
  }

  return (
    <Screen>
      <Text style={styles.title}>{crewCopy.help.title}</Text>
      <Text style={styles.intro}>{crewCopy.help.intro}</Text>

      <Card legible title={crewCopy.help.supportHeadline}>
        <Text style={styles.body}>{crewCopy.help.supportAdvice}</Text>
        {sos.active ? (
          <View style={styles.sosStatus}>
            <SosStatusLine
              status={sos.status}
              sentAt={sos.sentAt}
              active={sos.active}
              onRetry={sos.retry}
              busy={sos.busy}
            />
          </View>
        ) : null}
      </Card>

      {/**
       * The full GPS panel — permission chips, background-sharing switch,
       * last fix, server reason and the four support counters. Driver-only,
       * exactly as on the old trip screen (GPS sharing is the driver's job).
       */}
      {isDriver && trip ? (
        <>
          <SectionTitle>Live GPS sharing</SectionTitle>
          <GpsSharePanel trip={trip} sharing={sharing} />
          {/**
           * Recovery only: granting a permission here repairs the OS side.
           * It deliberately does NOT auto-start sharing — `GpsPermissionRecovery`
           * fires `onPermissionGranted` on every mount when all is well, and
           * sharing must only ever start from an explicit crew tap
           * (the trip screen's Retry button).
           */}
          <GpsPermissionRecovery
            lastSuccessfulUpdate={sharing.stats.lastFix?.recorded_at ?? null}
            onPermissionGranted={() => undefined}
          />
        </>
      ) : isDriver ? (
        <Card legible title="Live GPS sharing">
          <Text style={styles.body}>
            No trip today — the GPS counters appear here while a trip is running.
          </Text>
        </Card>
      ) : (
        <Card legible title="GPS sharing">
          <Text style={styles.body}>
            GPS sharing is the driver's job on this run. If the school cannot see the bus, ask the
            driver to open this page and read out the numbers.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  intro: {
    fontSize: 16,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  body: {
    fontSize: 16,
    color: colors.neutral[700],
  },
  sosStatus: {
    marginTop: spacing.sm,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
});
