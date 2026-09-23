import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { UserRole } from '@school-bus-tracking/shared-types';
import { useAuth } from '../../src/features/auth';
import {
  GpsBatteryGuidance,
  GpsSharePanel,
  useCrewLocationSharing,
  useCrewToday,
} from '../../src/features/crew';
import { GpsPermissionRecovery } from '../../src/features/crew/GpsPermissionRecovery';
import { SosStatusLine, useCrewSos } from '../../src/features/crew/SosPanel';
import { SoundSettingsCard } from '../../src/features/crew/SoundSettingsCard';
import { buildDiagnosticsRows } from '../../src/features/crew/crew-diagnostics';
import { getMapIssues } from '../../src/features/map/map-diagnostics';
import { crewCopy } from '../../src/features/crew/crew-copy';
import { API_BASE_URL } from '../../src/services/api.ts';
import '../../src/lib/runtime-env.ts';
import { getRuntime } from '../../src/lib/runtime-environment.ts';
import {
  Card,
  KeyValue,
  LanguageSwitcher,
  LoadingView,
  Screen,
  SectionTitle,
} from '../../src/components';
import { useTranslation } from '../../src/lib/i18n-provider';

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

/** Stable no-op: a granted permission on Help never starts sharing. */
const noopPermissionGranted = (): void => undefined;

export default function CrewHelpScreen() {
  const { user } = useAuth();
  const t = useTranslation();
  const { data, loading } = useCrewToday();
  const trip = data?.trip ?? null;
  // Same shared lifecycle as the trip screen: navigating here neither starts a
  // second watcher nor stops the run (see `tracking-lifecycle.ts`).
  const sharing = useCrewLocationSharing(
    trip,
    user ? { userId: user.id, schoolId: user.school_id ?? null } : null,
    { settled: Boolean(data) },
  );
  const sos = useCrewSos(trip?.id ?? null);
  const isDriver = user?.role === UserRole.DRIVER;

  if (loading && !data) {
    return <LoadingView label={t('help.loading')} />;
  }

  return (
    <Screen>
      <Text style={styles.title}>{crewCopy.help.title}</Text>
      <Text style={styles.intro}>{crewCopy.help.intro}</Text>

      {/**
       * Phase 3: the language switch. It sits at the top of Help because this
       * is the screen a crew member is sent to when something is not right —
       * including when the app is in a language they cannot read.
       */}
      <LanguageSwitcher />

      {/**
       * Phase 3b: voice + vibration, directly under the language switch —
       * both are "how the app talks to me" settings, and Help is the one
       * settings home (no new screen). The GPS telemetry below is untouched.
       */}
      <SoundSettingsCard />

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
          <SectionTitle>{t('gps.panelTitle')}</SectionTitle>
          <GpsSharePanel trip={trip} sharing={sharing} />
          {/**
           * Recovery only: granting a permission here repairs the OS side.
           * It deliberately does NOT auto-start sharing — `GpsPermissionRecovery`
           * fires `onPermissionGranted` on every mount when all is well, and
           * sharing must only ever start from an explicit crew action (the
           * driver's own lifecycle tap on the trip screen, or its Share GPS
           * button). The callback is a module-level constant on purpose: an
           * inline arrow here is a new function every render, and this panel's
           * OS check must not be re-armed by ordinary re-renders.
           */}
          <GpsPermissionRecovery
            sharing={sharing}
            lastSuccessfulUpdate={sharing.stats.lastAckAt}
            onPermissionGranted={noopPermissionGranted}
          />
          {/**
           * Battery / background-restriction guidance. Honest by construction:
           * no supported API reports the restriction state, so it never claims
           * to have detected one — it points at the OS setting instead.
           */}
          <GpsBatteryGuidance sharing={sharing} />
        </>
      ) : isDriver ? (
        <Card legible title={t('gps.panelTitle')}>
          <Text style={styles.body}>{t('gps.noTripBody')}</Text>
        </Card>
      ) : (
        <Card legible title={t('gps.driverOnlyTitle')}>
          <Text style={styles.body}>{t('gps.driverOnlyBody')}</Text>
        </Card>
      )}

      {/**
       * The diagnostics readout — available to EVERY crew role, with or
       * without a trip. It is the one place a support call can name: what
       * kind of app this phone runs (Expo Go cannot show the map or run the
       * background task), which server it talks to, and what the OS and the
       * lifecycle say about GPS. Pure readout: it renders rows from the
       * shared lifecycle snapshot and never starts or stops anything.
       */}
      <Card title={t('help.diagnostics.title')} description={t('help.diagnostics.hint')}>
        {buildDiagnosticsRows(sharing.trackingState, getRuntime(), API_BASE_URL, getMapIssues()).map((row) => (
          <KeyValue key={row.label} label={row.label} value={row.value} />
        ))}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  intro: {
    fontSize: 14,
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  body: {
    fontSize: 14,
    color: colors.neutral[700],
  },
  sosStatus: {
    marginTop: spacing.sm,
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    padding: spacing.sm,
  },
});
