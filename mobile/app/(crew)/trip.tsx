import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { UserRole, type StopResponse } from '@school-bus-tracking/shared-types';
import { spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import {
  GpsShareStrip,
  SosQuickPanel,
  StatusCard,
  TripStatusActions,
  TripNavigationCard,
  useCrewLocationSharing,
  useCrewToday,
} from '../../src/features/crew';
import { OfflineSyncBanner } from '../../src/features/crew/offline';
import { useLiveTripTracking } from '../../src/features/tracking/useLiveTripTracking';
import { ConnectionIndicator } from '../../src/features/tracking/ConnectionIndicator';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Button,
  EmptyState,
  ErrorState,
  KeyValue,
  LoadingView,
  Screen,
} from '../../src/components';
import { formatDate, formatTime, roleLabel } from '../../src/lib/format';
import { crewCopy } from '../../src/features/crew/crew-copy';
import { useTranslation } from '../../src/lib/i18n-provider';

/**
 * Crew "today" screen (DRIVER + CONDUCTOR) — Phase 2: **one job, one
 * screen**. The giant status card answers the only three questions a crew
 * member has while working — *what state are we in* (background colour +
 * 28px word), *where next* (stop + ETA, 24px) and *what do I do now* (one
 * 64px primary action). Route code, scheduled time, bus reg no., role chip,
 * connection state and departure stamps are de-prioritised — never deleted —
 * into the card's collapsible "More details".
 *
 * Around the card: the offline-sync banner, the driver's compact GPS strip
 * (Sharing ✅/❌ + last update + Retry; full telemetry lives on the
 * Help/Support screen), navigation to the next stop, the manifest/stops
 * links, and the hold-to-confirm SOS row.
 */
export default function CrewTripScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useTranslation();
  const { data, loading, refreshing, error, reload, refresh } = useCrewToday();
  const trip = data?.trip ?? null;
  /**
   * The tracking lifecycle is shared with the Help screen, so it is scoped to
   * the signed-in crew member: the persisted context is only ever resumed for
   * this user/school. `settled` stops a still-loading screen from reading "no
   * trip today" and tearing down a run that is in fact live.
   */
  const sharing = useCrewLocationSharing(
    trip,
    user ? { userId: user.id, schoolId: user.school_id ?? null } : null,
    { settled: Boolean(data) },
  );
  const live = useLiveTripTracking(trip?.id ?? null);
  const isDriver = user?.role === UserRole.DRIVER;

  // The ordered stops of the trip's route, used by the driver's navigation
  // hand-off. Loading them on this screen keeps the "Navigate" card honest:
  // it points at a real stop of this run, never at a guessed coordinate.
  const stopsLoad = useLoad<StopResponse[]>(async () => {
    if (!trip) return [];
    return unwrapEnvelope(await apiClient.listRouteStops(trip.route_id)).items;
  }, [trip?.route_id]);

  if (loading && !data) {
    return <LoadingView label={t('trip.loading')} />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState legible message={error ?? t('trip.loadError')} onRetry={() => void reload()} />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen refresh={() => void refresh()} refreshing={refreshing}>
        <EmptyState
          legible
          icon="bus-outline"
          title={t('trip.empty.title')}
          description={t('trip.empty.body')}
        />
      </Screen>
    );
  }

  const route = data.route;
  const bus = data.bus;

  const details = (
    <>
      <KeyValue
        legible
        label={crewCopy.details.route}
        value={route ? `${route.code} · ${route.name}` : t('trip.emptyValue')}
      />
      <KeyValue
        legible
        label={crewCopy.details.scheduled}
        value={formatTime(trip.scheduled_start_at)}
      />
      <KeyValue legible label={crewCopy.details.date} value={formatDate(trip.scheduled_start_at)} />
      <KeyValue
        legible
        label={crewCopy.details.bus}
        value={
          bus
            ? `${bus.registration_number}${bus.bus_number ? ` · ${bus.bus_number}` : ''}`
            : t('trip.emptyValue')
        }
      />
      {user ? (
        <KeyValue legible label={crewCopy.details.role} value={roleLabel(user.role)} />
      ) : null}
      <View style={styles.connectionRow}>
        <Text style={styles.connectionLabel}>{crewCopy.details.connection}</Text>
        <ConnectionIndicator connection={live.connection} />
      </View>
      {trip.actual_start_at ? (
        <Text style={styles.muted}>{crewCopy.departedAt(formatTime(trip.actual_start_at))}</Text>
      ) : null}
      {trip.actual_end_at ? (
        <Text style={styles.muted}>{crewCopy.arrivedAt(formatTime(trip.actual_end_at))}</Text>
      ) : null}
      {data.trips.length > 1 ? (
        <Text style={styles.muted}>{crewCopy.tripCountNote(data.trips.length)}</Text>
      ) : null}
    </>
  );

  return (
    <Screen refresh={() => void refresh()} refreshing={refreshing}>
      <StatusCard
        trip={trip}
        eta={live.eta}
        details={details}
        action={
          // Exactly one forward action (spec-pinned) on a white sheet so the
          // coloured button always sits on the measured white surface.
          <View style={styles.actionSheet}>
            <TripStatusActions trip={trip} offlineCapable onApplied={() => void reload()} />
          </View>
        }
      />

      <OfflineSyncBanner />

      {/**
       * Driver-only: GPS sharing is the driver's job. The strip is the whole
       * driving-time story (Sharing ✅/❌ + last update + Retry); the
       * counters and diagnostics moved to the Help/Support screen.
       */}
      {isDriver ? (
        <GpsShareStrip sharing={sharing} onOpenHelp={() => router.push('/help')} />
      ) : null}

      {isDriver ? (
        <TripNavigationCard
          trip={trip}
          stops={stopsLoad.data ?? []}
          nextStopId={live.eta?.next_stop?.stop_id ?? null}
        />
      ) : null}

      <View style={styles.linkRow}>
        <Button
          label={isDriver ? t('trip.link.manifestDriver') : t('trip.link.manifestConductor')}
          icon="people"
          variant="secondary"
          size="lg"
          onPress={() => router.push('/manifest')}
          style={styles.linkButton}
        />
        <Button
          label={t('trip.link.stops')}
          icon="location"
          variant="secondary"
          size="lg"
          onPress={() => router.push('/stops')}
          style={styles.linkButton}
        />
      </View>

      {/* SOS: one hold, one second — details & cancel live on the SOS tab. */}
      <SosQuickPanel tripId={trip.id} onOpenSosTab={() => router.push('/sos')} />

      <Button
        label={crewCopy.help.title}
        icon="help-circle"
        variant="ghost"
        size="md"
        onPress={() => router.push('/help')}
        style={styles.helpButton}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  actionSheet: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.md,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  connectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 32,
  },
  connectionLabel: {
    fontSize: 14,
    color: '#334155',
  },
  muted: {
    fontSize: 14,
    color: '#475569',
  },
  linkRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  linkButton: {
    flex: 1,
    borderRadius: borderRadius.md,
  },
  helpButton: {
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
});
