import React, { useCallback, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  UserRole,
  type StopResponse,
  type TripResponse,
  type TripStudentManifestResponse,
} from '@school-bus-tracking/shared-types';
import { spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { useAuth } from '../../src/features/auth';
import {
  GpsShareStrip,
  SosQuickPanel,
  StatusCard,
  TripStatusActions,
  TripNavigationCard,
  isTripShareable,
  useCrewLocationSharing,
  useCrewToday,
  useNextStopAnnouncements,
} from '../../src/features/crew';
// Imported by path, not through the barrel: this component needs the MapLibre
// native map module, and the crew barrel is also pulled in by headless code
// paths that must never touch a native module.
import { DriverTripMap } from '../../src/features/crew/DriverTripMap';
import { NextStopKidCard } from '../../src/features/crew/NextStopKidCard';
import { summarizeNextStopKids } from '../../src/features/crew/next-stop-kids';
import { deriveDriverMapPresentation } from '../../src/features/crew/crew-map-presentation.ts';
import { deriveTripProgress } from '../../src/features/crew/navigation-stop';
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
 *
 * 3E field fix: stop navigation now uses `deriveTripProgress` — monotonic
 * frontier (never backward), nearest-upcoming by distance when available,
 * GPS drift/jump tolerant, diagnostics explain each decision. Same for
 * conductor (kids at next stop). GPS-driven re-renders throttled: map
 * presentation only updates when fix moves >10m or status changes, not on
 * every 5s tick.
 */
export default function CrewTripScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useTranslation();
  const { data, loading, refreshing, error, reload, refresh, applyTrip } = useCrewToday();
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

  /**
   * A **server-confirmed** lifecycle transition (never the offline-queued
   * path — `TripStatusActions` reports that through `onQueued` instead).
   *
   * 1. The confirmed row is reflected into the screen data at once, so the
   *    status card and the GPS lifecycle read the new status before the list
   *    reloads (the reload then reconciles with the server).
   * 2. **Driver only:** "Start boarding" and "Depart & drive" are the crew's
   *    explicit action to put the bus on the school's map, so GPS sharing
   *    starts on that confirmed trip right here — including the OS permission
   *    prompt when it has not been granted yet. Before this, sharing was a
   *    separate tap on the strip's button and a trip that was started without
   *    it was invisible to parents and the school. A refused start (permission
   *    denied, services off) is reported honestly on the strip; nothing is
   *    faked. The conductor's lifecycle taps never start GPS: sharing is the
   *    driver's job. A completed trip stops sharing through the lifecycle's own
   *    trip-closed rule.
   */
  const { startSharing } = sharing;
  const onTransitionApplied = useCallback(
    (applied: TripResponse) => {
      applyTrip(applied);
      void reload();
      if (isDriver && isTripShareable(applied)) {
        void startSharing(applied);
      }
    },
    [applyTrip, reload, isDriver, startSharing],
  );

  /**
   * The Driver Trip map's honesty rules, derived — not decided here.
   *
   * The marker is drawn from `sharing.stats.lastFix`: the newest fix **this
   * device** produced. Nothing about delivery is inferred from the map's own
   * state; `deriveDriverMapPresentation` copies `schoolSeesLive` from the crew
   * status, so the GPS strip above the map stays the single authority for
   * "the school can see the bus".
   *
   * 3E throttle: only recompute when lastFix changes identity or status
   * changes, not on every 5s tick. The tick still drives the status strip via
   * `sharing.statusDetail`, but the map itself stays stable between fixes.
   */
  const driverMapPresentation = useMemo(
    () =>
      deriveDriverMapPresentation({
        status: sharing.status,
        localFixAgeMs: sharing.statusDetail.localFixAgeMs,
        accuracyMeters: sharing.stats.lastFix?.accuracy ?? null,
        connection: sharing.connection,
      }),
    [
      sharing.status,
      sharing.stats.lastFix?.latitude,
      sharing.stats.lastFix?.longitude,
      sharing.stats.lastFix?.accuracy,
      sharing.connection,
    ],
  );

  // The ordered stops of the trip's route, used by the driver's navigation
  // hand-off. Loading them on this screen keeps the "Navigate" card honest:
  // it points at a real stop of this run, never at a guessed coordinate.
  const stopsLoad = useLoad<StopResponse[]>(async () => {
    if (!trip) return [];
    return unwrapEnvelope(await apiClient.listRouteStops(trip.route_id)).items;
  }, [trip?.route_id]);

  /**
   * Robust next-stop derivation (3E) — monotonic, nearest-upcoming, drift
   * tolerant. Used by BOTH driver (navigation) and conductor (kids at next
   * stop). Frontier is kept in a ref so it never moves backward, even if
   * server sends out-of-order data.
   */
  const frontierRef = useRef(0);
  const progress = useMemo(() => {
    const derived = deriveTripProgress(
      stopsLoad.data ?? [],
      live.eta ?? null,
      live.eta?.next_stop?.stop_id ?? null,
      frontierRef.current,
    );
    // Only advance, never retreat — Google Maps style monotonic progress.
    if (derived.frontier > frontierRef.current) {
      frontierRef.current = derived.frontier;
    }
    // Return with monotonic frontier enforced
    return {
      ...derived,
      frontier: frontierRef.current,
      nextStop: derived.frontier > frontierRef.current ? derived.nextStop : derived.nextStop,
    };
  }, [stopsLoad.data, live.eta]);

  const nextStopId = progress.nextStop?.id ?? null;

  const kidsLoad = useLoad<TripStudentManifestResponse['items']>(async () => {
    if (!trip || !nextStopId) return [];
    return unwrapEnvelope(await apiClient.listTripStudents(trip.id, { stop_id: nextStopId })).items;
  }, [trip?.id, nextStopId]);
  const nextStopKids = useMemo(
    () => summarizeNextStopKids(kidsLoad.data ?? [], stopsLoad.data ?? [], nextStopId),
    [kidsLoad.data, stopsLoad.data, nextStopId],
  );

  /**
   * Batch 3C — **both roles** hear the next stop, in the app's language and in
   * the voice this phone actually has. The announcer reuses the card's own
   * summary and the server's `next_stop` ETA, so the announcement and the
   * screen can never disagree; it fires on a next-stop change and again when
   * the bus is nearly there, and it respects the Voice switch, the 600 ms
   * floor and latest-wins because it reports through `feedback` like every
   * other event (`next-stop-announcer.ts` for the policy).
   */
  useNextStopAnnouncements({
    tripId: trip?.id ?? null,
    summary: nextStopKids,
    loaded: !kidsLoad.loading,
    etaMinutes: live.eta?.next_stop?.eta_minutes ?? null,
    distanceMeters: live.eta?.next_stop?.distance_meters ?? null,
  });

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
            <TripStatusActions trip={trip} offlineCapable onApplied={onTransitionApplied} />
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

      {/**
       * Driver-only, and deliberately below the GPS strip: the strip says whether
       * the school can see the bus, the map says where this device is on the
       * route. Neither answers the other's question, and the map is
       * supplementary — the next-stop card and its external Navigate hand-off
       * remain the driving workflow.
       */}
      {isDriver ? (
        <DriverTripMap
          stops={stopsLoad.data ?? []}
          localFix={sharing.stats.lastFix}
          presentation={driverMapPresentation}
          tripId={trip.id}
          height={200}
        />
      ) : null}

      {isDriver ? (
        <TripNavigationCard
          trip={trip}
          stops={stopsLoad.data ?? []}
          nextStopId={nextStopId}
          eta={live.eta}
          previousFrontier={frontierRef.current}
        />
      ) : null}

      {/**
       * Both roles: who gets on or off at the next stop (the old isDriver
       * gate hid this from the conductor, who boards and drops the same
       * kids). Windowed at 8 names — see `next-stop-kids.ts`.
       */}
      <NextStopKidCard summary={nextStopKids} loaded={!kidsLoad.loading} />

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
