import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Feature, LineString, Polygon } from 'geojson';
import type {
  RouteGeometryLineString,
  StopResponse,
  TripLocationHistoryResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import {
  formatDistanceMeters,
  formatEtaMinutes,
  formatRelative,
  formatSpeedKmh,
  formatTime,
} from '../../lib/format';
import { useLoad } from '../../hooks/useLoad';
import { apiClient } from '../../services/api';
import { unwrapEnvelope } from '../../lib/errors';
import type { BusMotionFix } from '../map/bus-motion.ts';
import { accuracyCirclePolygon } from '../map/accuracy-circle';
import { MapIssueLines } from '../map/map-issue-lines';
import { decimateTrailLine } from '../map/polyline-simplify.ts';
import { LiveMapSurface } from '../map/LiveMapSurface';
import { loadTripRoadGeometry } from './offline/route-geometry-cache';
import {
  driverMapCopy,
  driverMapNoFixLabel,
  type DriverMapNoFixAction,
  type DriverMapNoFixCta,
  type DriverMapPresentation,
} from './crew-map-presentation.ts';
import {
  buildPlannedLegsLine,
  buildRoadRouteLine,
  buildTrailLine,
  historyFixesForTrip,
} from './trip-map-geometry.ts';

/**
 * The **Driver Trip** map: where this driver is, on their own run.
 *
 * ### One surface, shared
 *
 * Everything the map itself does — the engine, the gesture ownership, the
 * follow controls, the zoom buttons, fullscreen, the one-layer stops, the
 * next-stop highlight and the arrival-zone ring — lives in
 * `features/map/LiveMapSurface.tsx` and is rendered by every role
 * (`variant: 'driver'` here, `'observer'` on the admin/parent/conductor
 * `BusMap`). This wrapper owns only what is genuinely the driver's:
 *
 * - the **GPS honesty panel** (`crew-map-presentation.ts`'s copy: the position
 *   line always, the delivery line only while the school cannot see what is
 *   drawn) and its no-fix repair CTA, which re-runs the **GPS strip's own**
 *   action rather than inventing a second recovery mechanism;
 * - the **trail** (the server's recorded fixes for this trip) and the **road
 *   line** ahead, both built by the pure `trip-map-geometry.ts`;
 * - the next-stop driving line on the card.
 *
 * ### Supplementary by design
 *
 * This is not turn-by-turn navigation, and it must never become a screen the
 * driver has to operate while moving. It is one card: the route's stops, this
 * device's own position, and one honest status line. The next-stop card and
 * the external **Navigate** hand-off below it remain the driving workflow; the
 * SOS, attendance and trip-status controls stay one tap away. Nothing here is
 * required to complete a trip — losing the map costs the driver nothing.
 *
 * ### The marker's data source, stated once
 *
 * `localFix` is the newest coordinate **this device produced**
 * (`useCrewLocationSharing().stats.lastFix`). It is drawn as-is: no server
 * round trip, no second GPS watcher, no extra socket subscription. The screen's
 * existing GPS-sharing strip remains the authority for whether anyone else can
 * see it, and `presentation` (from `crew-map-presentation.ts`) carries that
 * verdict through unchanged — the map never states or implies "the school sees
 * you". When the position has not been delivered, the panel says so, in words.
 *
 * Interpolated coordinates — the ones the surface animates through between
 * fixes — are presentation only. They are never written into history, ETA,
 * attendance or notifications, exactly as on the observer map.
 *
 * ### The lines, and the honesty each one owes
 *
 * - **Trail** (dotted, green) — the path already driven, built by
 *   `buildTrailLine` from the server's recorded fixes
 *   (`GET /trips/:id/location/history`, scoped to *this* trip by
 *   `historyFixesForTrip`), then decimated to ~5 m (`polyline-simplify.ts`)
 *   before it reaches the map source. The only line here allowed to be called
 *   "driven".
 * - **The road ahead** (solid, amber) — the routing engine's polyline for
 *   this route (`GET /routes/:id/geometry`), loaded **once per trip** by
 *   `loadTripRoadGeometry` (offline-cached, so a driver who loses signal
 *   mid-trip keeps the line) and trimmed to start at the next stop by
 *   `buildRoadRouteLine`. When the road cannot be drawn honestly — routing
 *   unavailable, offline with nothing cached, a next stop the cached shape
 *   does not serve — the **planned legs** take its place: `buildPlannedLegsLine`'s
 *   straight stop-to-stop segments, in the same amber paint. The legend
 *   caption follows the shape (`map.roadNotice` vs `map.plannedNotice`): only
 *   the fallback may read as "planned stop order — not the road route".
 *
 * The next-stop id is always an input (`nextStopId`): the marker, the card
 * line, the Navigate hand-off and the voice all read the one derivation, and
 * the map never picks a next stop of its own.
 */
export interface DriverTripMapProps {
  /** The trip's stops, in order. Coordinates are optional on the API shape. */
  stops: StopResponse[];
  /** The newest fix from this device alone, or `null` before the first one. */
  localFix: BusMotionFix | null;
  /** Crew freshness verdict — see `deriveDriverMapPresentation`. */
  presentation: DriverMapPresentation;
  /** Changing trip drops the previous bus's rendered position. */
  tripId?: string | null;
  /**
   * Height of the embedded card. The default is the field floor: below ~240 dp
   * a pinch has no room to resolve and the map reads as a thumbnail rather
   * than something to operate.
   */
  height?: number;
  /**
   * The repair the panel offers while no position exists, decided by
   * `driverMapNoFixCta` from the **GPS strip's own** action — the map never
   * invents a second recovery mechanism. `null` shows no button.
   */
  noFixCta?: DriverMapNoFixCta | null;
  /** Runs the CTA. The screen owns the actions (`useCrewLocationSharing`). */
  onNoFixAction?: (action: DriverMapNoFixAction) => void;
  /** The sharing lifecycle is busy: the CTA must not be tapped twice. */
  busy?: boolean;
  /**
   * The next stop's id, from `deriveTripProgressForTrip(...).nextStop?.id` —
   * the same derivation the navigation card and the kids card read. `null`
   * draws every stop plain; the map never chooses a highlight itself.
   */
  nextStopId?: string | null;
  /** The next stop's name, for the driving line on the card. */
  nextStopName?: string | null;
  /** Server-computed distance to the next stop (`eta.next_stop`). */
  nextStopDistanceMeters?: number | null;
  /** Server-computed ETA to the next stop, in minutes (`eta.next_stop`). */
  nextStopEtaMinutes?: number | null;
}

/**
 * The floor for the embedded card, in dp.
 *
 * The screen used to pass 200, which is about six rows of map either side of
 * the marker: a pinch has nowhere to resolve, the follow controls and the
 * honesty panel take a third of it, and everything reads as a thumbnail. 240
 * is the smallest height at which the card is still a *map* — and the driver
 * has Full screen for anything more.
 */
export const EMBEDDED_MAP_MIN_HEIGHT = 240;

/**
 * How many recorded fixes the trail reads per load (the endpoint caps at 500;
 * 200 breadcrumb points bound the payload while covering most of a run).
 */
const TRAIL_FIX_LIMIT = 200;

export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  tripId = null,
  height = EMBEDDED_MAP_MIN_HEIGHT,
  nextStopId = null,
  nextStopName = null,
  nextStopDistanceMeters = null,
  nextStopEtaMinutes = null,
  noFixCta = null,
  onNoFixAction,
  busy = false,
}) => {
  // `t()` reads module state, so subscribing is what makes a language switch
  // re-render this component (the surface subscribes for its own strings).
  useTranslation();

  // The travelled path: the server's recorded fixes for THIS trip (the payload
  // names its trip, so a switch back/forth cannot play the wrong run's path).
  const trailLoad = useLoad<TripLocationHistoryResponse | null>(async () => {
    if (!tripId) return null;
    return unwrapEnvelope(
      await apiClient.getTripLocationHistory(tripId, { limit: TRAIL_FIX_LIMIT }),
    );
  }, [tripId]);
  const trailFeature = useMemo<Feature<LineString> | null>(() => {
    const line = buildTrailLine(historyFixesForTrip(trailLoad.data ?? null, tripId));
    // Decimated (~5 m) before it is handed to the map source: the payload's
    // raw fixes are mostly sub-accuracy jitter, and the surface re-sets the
    // line on every remount (fullscreen opens included).
    return line ? decimateTrailLine(line) : null;
  }, [trailLoad.data, tripId]);

  // The planned order ahead, from the same next stop every other surface reads.
  const plannedFeature = useMemo<Feature<LineString> | null>(
    () => buildPlannedLegsLine(stops, nextStopId),
    [stops, nextStopId],
  );

  // The road ahead: the routing engine's polyline for this route, loaded ONCE
  // per trip — remounts (the fullscreen map included) and next-stop changes
  // answer from the loader's memory, and its offline copy answers when the
  // signal is gone (`offline/route-geometry-cache.ts`).
  const routeId = stops[0]?.route_id ?? null;
  const roadGeometryLoad = useLoad<{
    routeId: string | null;
    geometry: RouteGeometryLineString | null;
  }>(async () => {
    if (!tripId || !routeId) return { routeId: null, geometry: null };
    return { routeId, geometry: await loadTripRoadGeometry(tripId, routeId) };
  }, [tripId, routeId]);
  // `useLoad` keeps the previous load's data while the next request is in
  // flight — so a geometry fetched for another route must never survive a
  // route switch, exactly like `historyFixesForTrip` refuses another trip's
  // fixes. The payload names the route it was loaded for.
  const roadGeometry =
    roadGeometryLoad.data && roadGeometryLoad.data.routeId === routeId
      ? roadGeometryLoad.data.geometry
      : null;
  const roadFeature = useMemo<Feature<LineString> | null>(
    () => buildRoadRouteLine(roadGeometry, { fromStopId: nextStopId, stops }),
    [roadGeometry, nextStopId, stops],
  );

  // One amber line ahead of the bus, in the most honest shape available: the
  // road when the geometry serves this trip, the planned legs otherwise. Same
  // colour, same width — the legend caption (`plannedLineKind`) is what tells
  // the two shapes apart.
  const aheadFeature = roadFeature ?? plannedFeature;

  const accuracyCircleFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!localFix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: localFix.latitude, longitude: localFix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [localFix, presentation.accuracyCircleMeters]);

  // Both lines, resolved together: the position line always, the delivery line
  // only when the school cannot see what is drawn (see `crew-map-presentation`).
  const copy = driverMapCopy(presentation, localFix ? formatRelative(localFix.recorded_at) : '');

  // The driving line on the card: the three facts a driver needs without
  // reading a list — which stop, how far, how long. All three are the
  // server's numbers; nothing is estimated here.
  const nextLine = nextStopName
    ? t('driverMap.nextSummary', {
        name: nextStopName,
        distance:
          nextStopDistanceMeters !== null ? formatDistanceMeters(nextStopDistanceMeters) : '—',
        eta: formatEtaMinutes(nextStopEtaMinutes) ?? '—',
      })
    : null;

  // Only changes when the fix changes: a per-tick callout would re-render the
  // native surface every 5 s for a string nobody can see until they tap it.
  const busDescription = !localFix
    ? ''
    : `${formatSpeedKmh(localFix.speed)} · ${formatTime(localFix.recorded_at)}`;

  // Fullscreen is a remount (the engine reads its initial camera once), so it
  // is also the moment the trail is re-read — the freshest path for the
  // driver's zoomed-in look.
  const openFullscreen = useCallback(() => {
    if (tripId) void trailLoad.refresh();
  }, [tripId, trailLoad]);

  // The driver's panel: the honesty lines and the repair tap. Positioning
  // (top-left, clear of the attribution) is owned by the surface; the words
  // are owned here.
  const panel = (
    <View style={styles.panel}>
      <View style={styles.panelChips}>
        <Text style={styles.chipSource}>{t('driverMap.source')}</Text>
        {presentation.approximate ? (
          <Text style={styles.chipNeutral}>{t('map.status.approximate')}</Text>
        ) : null}
      </View>
      {/* How current the position is, always; then why the school cannot see
          it, only when that is true. */}
      <Text style={styles.panelNote}>{copy.position}</Text>
      {copy.delivery ? <Text style={styles.panelNote}>{copy.delivery}</Text> : null}
      {/* With nothing to draw, the panel offers the repair the GPS strip
          already decided on instead of leaving the driver at a dead end
          (P2-7). It never starts a mechanism of its own — every action here
          is one of the strip's, run by the screen. */}
      {noFixCta ? (
        <Pressable
          onPress={() => onNoFixAction?.(noFixCta.action)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel={driverMapNoFixLabel(noFixCta)}
          accessibilityState={{ disabled: busy }}
          hitSlop={6}
          style={({ pressed }) => [
            styles.panelCta,
            pressed ? styles.panelCtaPressed : null,
            busy ? styles.controlDisabled : null,
          ]}
        >
          <Text style={styles.panelCtaText}>{driverMapNoFixLabel(noFixCta)}</Text>
        </Pressable>
      ) : null}
      {/* Map style/label failures are visible here — never blank-silent. */}
      <MapIssueLines />
    </View>
  );

  return (
    <LiveMapSurface
      variant="driver"
      stops={stops}
      fix={localFix}
      tripId={tripId}
      height={height}
      nextStopId={nextStopId}
      trailFeature={trailFeature}
      plannedFeature={aheadFeature}
      plannedLineKind={roadFeature ? 'road' : 'planned'}
      accuracyCircleFeature={accuracyCircleFeature}
      animate={presentation.animate}
      busTitle={t('map.busA11y')}
      busDescription={busDescription}
      panel={panel}
      headerTitle={nextLine ?? t('trip.nextStopFallback')}
      onExpandStart={openFullscreen}
    />
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    alignItems: 'flex-start',
    gap: 2,
    // The controls column owns the right-hand side; the panel keeps clear of
    // it so a long delivery line can never run underneath the buttons.
    maxWidth: '58%',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  panelChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
  },
  chipSource: {
    // Crew surfaces hold a 14px floor (`theme/legibility.spec.ts`).
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  chipNeutral: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  panelNote: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
  /** The panel's repair tap while there is no fix to draw. */
  panelCta: {
    marginTop: 4,
    minHeight: 36,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
    borderRadius: borderRadius.full,
    backgroundColor: colors.secondary[700],
  },
  panelCtaPressed: {
    backgroundColor: colors.secondary[800],
  },
  panelCtaText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: '#ffffff',
  },
  controlDisabled: {
    opacity: 0.55,
  },
});
