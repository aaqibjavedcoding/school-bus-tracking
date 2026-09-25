import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type NativeSyntheticEvent,
} from 'react-native';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  type CameraRef,
  type InitialViewState,
  type MapProps,
  type ViewStateChangeEvent,
} from '@maplibre/maplibre-react-native';
import type { Feature, LineString, Polygon } from 'geojson';
import type {
  StopResponse,
  TripLocationHistoryResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useLocale, useTranslation } from '../../lib/i18n-provider';
import '../../lib/runtime-env.ts';
import { getRuntime } from '../../lib/runtime-environment.ts';
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
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { BusMarker } from '../map/BusMarker';
import { StopMarker } from '../map/StopMarker';
import { accuracyCirclePolygon } from '../map/accuracy-circle';
import type { BusMotionFix } from '../map/bus-motion.ts';
import { SINGLE_POINT_ZOOM, initialCameraFor } from '../map/fit-camera.ts';
import { MapIssueLines } from '../map/map-issue-lines';
import { reportMapIssue } from '../map/map-diagnostics';
import { useMapStyle } from '../map/use-map-style';
import { mapSurfaceMode } from '../map/map-surface-mode';
import { NeedsDevBuildPanel } from '../map/needs-dev-build-panel';
import type { RenderedMarker } from '../map/useBusMarkerMotion';
import { useFollowCamera } from '../map/useFollowCamera';
import {
  buildPlannedLegsLine,
  buildTrailLine,
  historyFixesForTrip,
} from './trip-map-geometry.ts';
import { driverMapCopy, driverStopMarkerKind, type DriverMapPresentation } from './crew-map-presentation.ts';

/**
 * MapLibre renders its children (Camera, sources, layers, annotations) by
 * spreading its props onto the native view, so children work at runtime. In
 * this monorepo the package hoists above `react-native`, so tsc cannot
 * resolve the RN `ViewProps` the component's prop type extends and silently
 * drops `children` from it — restore that one prop here rather than fight
 * the hoisted layout.
 */
const MapView = Map as unknown as React.ComponentType<MapProps & { children?: React.ReactNode }>;

/**
 * The **Driver Trip** map: where this driver is, on their own run.
 *
 * ### Supplementary by design
 *
 * This is not turn-by-turn navigation, and it must never become a screen the
 * driver has to operate while moving. It is one card: the route's stops, this
 * device's own position, and one honest status line. The next-stop card and the
 * external **Navigate** hand-off below it remain the driving workflow; the SOS,
 * attendance and trip-status controls stay one tap away. Nothing here is
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
 * Interpolated coordinates — the ones this component animates through between
 * fixes — are presentation only. They are never written into history, ETA,
 * attendance or notifications, exactly as on the observer map.
 *
 * ### The two lines, and the honesty each one owes
 *
 * - **Trail** (dotted, green) — the path already driven, built by
 *   `buildTrailLine` from the server's recorded fixes
 *   (`GET /trips/:id/location/history`, scoped to *this* trip by
 *   `historyFixesForTrip`). The only line here allowed to be called "driven".
 * - **Planned legs** (solid, amber) — stop-to-stop straight segments from the
 *   next stop onward, built by `buildPlannedLegsLine` from the same
 *   `deriveTripProgressForTrip` next stop the card below uses. It is the
 *   **planned order, not a road route** — the platform has no routing engine —
 *   so the caption under the map says exactly that.
 *
 * The next-stop id is always an input (`nextStopId`): the marker, the card
 * line, the Navigate hand-off and the voice all read the one derivation, and
 * the map never picks a next stop of its own.
 *
 * ### The engine, and what it must never become
 *
 * Same engine and style policy as the observer map (`map-style.ts`,
 * `docs/live-tracking-map.md` → "Map provider policy"): OpenFreeMap over
 * OpenStreetMap by default, an https-only self-hosted override later, no key
 * and no billing. With no network the tiles simply do not load; the marker,
 * the stops and the device position line are overlays and keep working.
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
  height?: number;
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
 * Padding that keeps markers off the edge when the route is fitted.
 */
const FIT_EDGE_PADDING = { top: 48, right: 48, bottom: 48, left: 48 };

/**
 * How many recorded fixes the trail reads per load (the endpoint caps at 500;
 * 200 breadcrumb points bound the payload while covering most of a run).
 */
const TRAIL_FIX_LIMIT = 200;

/**
 * School-bus amber with an explicit alpha — `rgba()` rather than an 8-digit
 * hex because it is parsed identically by style-spec paint properties on both
 * platforms. Identical to the observer map's circle so a coarse fix looks the
 * same on both.
 */
const ACCURACY_STROKE = 'rgba(245, 158, 11, 0.45)';
const ACCURACY_FILL = 'rgba(245, 158, 11, 0.13)';

/** Trail and planned-legs paint, stated once for both native map instances. */
const TRAIL_PAINT = {
  'line-color': colors.status.success,
  'line-width': 3,
  'line-dasharray': [1.5, 1.5] as number[],
};
const PLANNED_PAINT = {
  'line-color': colors.primary[600],
  'line-width': 4,
};

interface SurfaceProps {
  stops: Array<StopResponse & { latitude: number; longitude: number }>;
  routeLineFeature: Feature<LineString> | null;
  trailFeature: Feature<LineString> | null;
  plannedFeature: Feature<LineString> | null;
  accuracyCircleFeature: Feature<Polygon> | null;
  initialCamera: InitialViewState | null;
  /** From `useMapStyle`: the URL, or the glyph-repaired style object. */
  mapStyle: MapProps['mapStyle'];
  localFix: BusMotionFix | null;
  tripId: string | null;
  reducedMotion: boolean;
  animate: boolean;
  busTitle: string;
  busDescription: string;
  /** The next stop's id — the only stop drawn with the big amber pin. */
  nextStopId: string | null;
  /**
   * Declared so the memo compares it — busting the cache on a language switch
   * so the callouts re-translate — but deliberately NOT destructured.
   */
  locale: string;
  onFrame: (marker: RenderedMarker) => void;
  onRegionChange: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onRegionChangeComplete: (event: NativeSyntheticEvent<ViewStateChangeEvent>) => void;
  onMapReady: () => void;
  cameraRef: React.RefObject<CameraRef | null>;
}

/**
 * Memoised so the 5 s status tick and the surrounding screen's state cannot
 * reach the native map. Every prop is either stable per trip or changes only
 * when the fix does.
 */
const DriverMapSurface: React.FC<SurfaceProps> = React.memo(
  ({
    stops,
    routeLineFeature,
    trailFeature,
    plannedFeature,
    accuracyCircleFeature,
    initialCamera,
    localFix,
    tripId,
    reducedMotion,
    animate,
    busTitle,
    busDescription,
    nextStopId,
    onFrame,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    cameraRef,
    mapStyle,
  }) => (
    <MapView
      style={styles.map}
      mapStyle={mapStyle}
      // OSM-derived tiles legally require the attribution and the logo;
      // MapLibre renders both in the BOTTOM corners, so the panel lives
      // top-left.
      attribution
      logo
      onRegionIsChanging={onRegionChange}
      onRegionDidChange={onRegionChangeComplete}
      onDidFinishLoadingMap={onMapReady}
      onDidFailLoadingMap={() => reportMapIssue('styleLoad')}
    >
      {/* Uncontrolled after the initial state; imperative via cameraRef. */}
      <Camera ref={cameraRef} initialViewState={initialCamera ?? undefined} />

      {routeLineFeature ? (
        <GeoJSONSource id="sbt-route" data={routeLineFeature}>
          <Layer
            type="line"
            id="sbt-route-line"
            source="sbt-route"
            paint={{
              'line-color': colors.neutral[400],
              'line-width': 2,
              'line-dasharray': [4, 4],
              'line-opacity': 0.8,
            }}
          />
        </GeoJSONSource>
      ) : null}

      {/* The driven path — recorded fixes only, never inferred. */}
      {trailFeature ? (
        <GeoJSONSource id="sbt-trail" data={trailFeature}>
          <Layer type="line" id="sbt-trail-line" source="sbt-trail" paint={TRAIL_PAINT} />
        </GeoJSONSource>
      ) : null}

      {/* The planned stop order ahead — the caption under the map says it is
          not the road route. */}
      {plannedFeature ? (
        <GeoJSONSource id="sbt-planned" data={plannedFeature}>
          <Layer type="line" id="sbt-planned-line" source="sbt-planned" paint={PLANNED_PAINT} />
        </GeoJSONSource>
      ) : null}

      {/* Uncertainty drawn rather than asserted. Centred on the reported fix,
          not on the interpolated marker, because the radius belongs to the
          measurement. */}
      {accuracyCircleFeature ? (
        <GeoJSONSource id="sbt-accuracy" data={accuracyCircleFeature}>
          <Layer
            type="fill"
            id="sbt-accuracy-fill"
            source="sbt-accuracy"
            paint={{ 'fill-color': ACCURACY_FILL }}
          />
          <Layer
            type="line"
            id="sbt-accuracy-stroke"
            source="sbt-accuracy"
            paint={{ 'line-color': ACCURACY_STROKE, 'line-width': 1 }}
          />
        </GeoJSONSource>
      ) : null}

      {stops.map((stop) => (
        <StopMarker
          key={stop.id}
          id={`stop-${stop.id}`}
          latitude={stop.latitude}
          longitude={stop.longitude}
          title={stop.name}
          label={t('map.stopLabel', { number: stop.sequence_number, name: stop.name })}
          description={`${t('map.stopA11y', { number: stop.sequence_number })}${
            stop.address ? ` · ${stop.address}` : ''
          }`}
          variant={driverStopMarkerKind(stop.id, nextStopId)}
        />
      ))}

      {/* Rendered after the stops so the bus draws above them (tree order is
          the annotation z-order). */}
      {localFix ? (
        <BusMarker
          fix={localFix}
          tripId={tripId}
          reducedMotion={reducedMotion}
          animate={animate}
          title={busTitle}
          description={busDescription}
          onFrame={onFrame}
        />
      ) : null}
    </MapView>
  ),
);
DriverMapSurface.displayName = 'DriverMapSurface';

export const DriverTripMap: React.FC<DriverTripMapProps> = ({
  stops,
  localFix,
  presentation,
  tripId = null,
  height = 220,
  nextStopId = null,
  nextStopName = null,
  nextStopDistanceMeters = null,
  nextStopEtaMinutes = null,
}) => {
  const reducedMotion = useReducedMotion();
  const locale = useLocale();
  // `t()` reads module state, so subscribing is what makes a language switch
  // re-render this component.
  useTranslation();

  const locatedStops = useMemo(
    () =>
      stops.filter(
        (stop): stop is StopResponse & { latitude: number; longitude: number } =>
          stop.latitude !== null && stop.longitude !== null,
      ),
    [stops],
  );
  const routeCoordinates = useMemo(
    () => locatedStops.map((stop) => ({ latitude: stop.latitude, longitude: stop.longitude })),
    [locatedStops],
  );
  const routeLineFeature = useMemo<Feature<LineString> | null>(() => {
    if (routeCoordinates.length < 2) return null;
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: routeCoordinates.map((point) => [point.longitude, point.latitude]),
      },
    };
  }, [routeCoordinates]);

  // The travelled path: the server's recorded fixes for THIS trip (the payload
  // names its trip, so a switch back/forth cannot play the wrong run's path).
  const trailLoad = useLoad<TripLocationHistoryResponse | null>(async () => {
    if (!tripId) return null;
    return unwrapEnvelope(
      await apiClient.getTripLocationHistory(tripId, { limit: TRAIL_FIX_LIMIT }),
    );
  }, [tripId]);
  const trailFeature = useMemo<Feature<LineString> | null>(
    () => buildTrailLine(historyFixesForTrip(trailLoad.data ?? null, tripId)),
    [trailLoad.data, tripId],
  );

  // The planned order ahead, from the same next stop every other surface reads.
  const plannedFeature = useMemo<Feature<LineString> | null>(
    () => buildPlannedLegsLine(stops, nextStopId),
    [stops, nextStopId],
  );

  const accuracyCircleFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!localFix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: localFix.latitude, longitude: localFix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [localFix, presentation.accuracyCircleMeters]);

  // Follow is explicit, not a side effect: the camera follows the bus until
  // the driver turns it off (or pans), and off means off — the frame stream
  // stops moving the camera entirely until it is turned back on.
  const [followEnabled, setFollowEnabled] = useState(true);
  const followEnabledRef = useRef(true);
  const toggleFollow = useCallback(() => {
    setFollowEnabled((previous) => {
      const next = !previous;
      followEnabledRef.current = next;
      return next;
    });
  }, []);

  const {
    cameraRef,
    exploring,
    onFrame,
    onRegionChange,
    onRegionChangeComplete,
    onMapReady,
    recenter,
  } = useFollowCamera({
    routeCoordinates,
    fix: localFix ? { latitude: localFix.latitude, longitude: localFix.longitude } : null,
    tripId,
    singlePointZoom: SINGLE_POINT_ZOOM,
    edgePadding: FIT_EDGE_PADDING,
  });
  // The gate lives in the frame callback (a ref read), so turning follow off
  // re-renders nothing native and re-enabling pans back via `recenter()`.
  const onFollowFrame = useCallback(
    (marker: RenderedMarker) => {
      if (!followEnabledRef.current) return;
      onFrame(marker);
    },
    [onFrame],
  );
  const turnFollowOn = useCallback(() => {
    if (!followEnabledRef.current) toggleFollow();
    recenter();
  }, [toggleFollow, recenter]);

  // Only changes when the fix changes: a per-tick callout would re-render the
  // native surface every 5 s for a string nobody can see until they tap it.
  const busDescription = !localFix
    ? ''
    : `${formatSpeedKmh(localFix.speed)} · ${formatTime(localFix.recorded_at)}`;

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

  // The honest captions: what each drawn line is, and is not.
  const plannedNotice = plannedFeature ? t('map.plannedNotice') : null;
  const trailNotice = trailFeature ? t('map.trailNotice') : null;
  const routeNotice = !plannedNotice && routeCoordinates.length > 1 ? t('map.routeNotice') : null;

  const initialCamera = useMemo(() => {
    const points: Array<{ latitude: number; longitude: number }> = [...routeCoordinates];
    if (localFix) points.push({ latitude: localFix.latitude, longitude: localFix.longitude });
    return initialCameraFor(points);
    // Keyed on stops only: `initialViewState` is read once by the engine, and
    // recomputing it per fix would be a controlled camera in disguise.
    // (`localFix` is read inside but deliberately not a dependency, for the
    // same reason the old `initialRegion` was keyed on stops alone.)
  }, [routeCoordinates]);

  // Which surface fills the map's box: tiles, the labelled development-build
  // panel, or the empty-route state (Expo Go carries no map engine on any
  // platform — see `map-surface-mode.ts`).
  const surfaceMode = mapSurfaceMode(getRuntime(), routeCoordinates.length > 0, !!localFix);

  // Fullscreen is a remount (the engine reads its initial camera once), so it
  // is also the moment the trail is re-read — the freshest path for the
  // driver's zoomed-in look.
  const [expanded, setExpanded] = useState(false);
  const openFullscreen = useCallback(() => {
    setExpanded(true);
    if (tripId) void trailLoad.refresh();
  }, [tripId, trailLoad]);
  const closeFullscreen = useCallback(() => setExpanded(false), []);

  const { mapStyle } = useMapStyle();

  const mapSurfaceEl = (
    <DriverMapSurface
      stops={locatedStops}
      routeLineFeature={routeLineFeature}
      trailFeature={trailFeature}
      plannedFeature={plannedFeature}
      accuracyCircleFeature={accuracyCircleFeature}
      initialCamera={initialCamera}
      localFix={localFix}
      tripId={tripId}
      reducedMotion={reducedMotion}
      animate={presentation.animate}
      busTitle={t('map.busA11y')}
      busDescription={busDescription}
      nextStopId={nextStopId}
      locale={locale}
      onFrame={onFollowFrame}
      onRegionChange={onRegionChange}
      onRegionChangeComplete={onRegionChangeComplete}
      onMapReady={onMapReady}
      cameraRef={cameraRef}
      mapStyle={mapStyle}
    />
  );

  const overlays = (fullHeight: boolean) => (
    <>
      {/* Top-left: clear of the MapLibre attribution and logo (bottom
          corners). Kept on every surface — the device's own position line
          is true even when the tiles are not. */}
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
        {/* Map style/label failures are visible here — never blank-silent. */}
        <MapIssueLines />
      </View>

      <View style={[styles.controls, fullHeight ? styles.controlsFull : null]}>
        <Pressable
          onPress={followEnabled ? toggleFollow : turnFollowOn}
          accessibilityRole="button"
          accessibilityLabel={followEnabled ? t('map.followOn') : t('map.followOff')}
          hitSlop={6}
          style={({ pressed }) => [styles.followButton, pressed ? styles.followPressed : null]}
        >
          <Text style={styles.followButtonText}>
            {followEnabled ? t('map.followOn') : t('map.followOff')}
          </Text>
        </Pressable>
        {followEnabled && exploring ? (
          <Pressable
            onPress={recenter}
            accessibilityRole="button"
            accessibilityLabel={t('map.followBus')}
            hitSlop={6}
            style={({ pressed }) => [styles.followButton, pressed ? styles.followPressed : null]}
          >
            <Text style={styles.followButtonText}>{t('map.followBus')}</Text>
          </Pressable>
        ) : null}
      </View>

      {/* The follow state is invisible to a screen reader unless spoken. */}
      <Text accessibilityLiveRegion="polite" style={styles.screenReaderOnly}>
        {!followEnabled
          ? t('map.followOff')
          : exploring
            ? t('map.exploringA11y')
            : t('map.followingA11y')}
      </Text>
    </>
  );

  if (surfaceMode === 'no-coordinates') {
    return (
      <View style={[styles.placeholder, { height }]}>
        <Text style={styles.placeholderText}>{t('map.noCoordinates')}</Text>
      </View>
    );
  }

  const mapBody = (fullHeight: boolean) => (
    <View style={[styles.wrap, { height: fullHeight ? undefined : height }]}>
      {surfaceMode === 'needs-dev-build' ? (
        // The driver's GPS still works in Expo Go — only the map engine is
        // missing, so the panel names that instead of showing a blank box.
        <NeedsDevBuildPanel />
      ) : (
        mapSurfaceEl
      )}
      {overlays(fullHeight)}
    </View>
  );

  return (
    <View>
      {/* Driving line: the card answers "what's next" before the map box, so
          the fact survives even when the tiles do not. */}
      <View style={styles.cardHeader}>
        <Text style={styles.nextLine} numberOfLines={2}>
          {nextLine ?? t('trip.nextStopFallback')}
        </Text>
        {surfaceMode === 'map' ? (
          <Pressable
            onPress={openFullscreen}
            accessibilityRole="button"
            accessibilityLabel={t('map.expand')}
            hitSlop={6}
            style={({ pressed }) => [styles.expandButton, pressed ? styles.followPressed : null]}
          >
            <Text style={styles.followButtonText}>{t('map.expand')}</Text>
          </Pressable>
        ) : null}
      </View>

      {surfaceMode === 'map' && expanded ? (
        <Modal animationType="slide" onRequestClose={closeFullscreen} accessibilityViewIsModal>
          <View style={styles.fullscreen}>
            <View style={styles.fullscreenHeader}>
              <Text style={styles.fullscreenTitle} numberOfLines={1}>
                {nextLine ?? t('map.busA11y')}
              </Text>
              <Pressable
                onPress={closeFullscreen}
                accessibilityRole="button"
                accessibilityLabel={t('map.exitFullscreen')}
                hitSlop={6}
                style={({ pressed }) => [
                  styles.followButton,
                  pressed ? styles.followPressed : null,
                ]}
              >
                <Text style={styles.followButtonText}>{t('map.exitFullscreen')}</Text>
              </Pressable>
            </View>
            {mapBody(true)}
            <View style={styles.fullscreenNotices}>
              {plannedNotice ? <Text style={styles.routeNotice}>{plannedNotice}</Text> : null}
              {trailNotice ? <Text style={styles.routeNotice}>{trailNotice}</Text> : null}
              {routeNotice ? <Text style={styles.routeNotice}>{routeNotice}</Text> : null}
            </View>
          </View>
        </Modal>
      ) : (
        mapBody(false)
      )}

      {/* Below the map, never over it: the bottom corners belong to the
          provider's attribution and logo. Each caption appears only while its
          line is on the map. */}
      {surfaceMode === 'map' && !expanded ? (
        <View>
          {plannedNotice ? <Text style={styles.routeNotice}>{plannedNotice}</Text> : null}
          {trailNotice ? <Text style={styles.routeNotice}>{trailNotice}</Text> : null}
          {routeNotice ? <Text style={styles.routeNotice}>{routeNotice}</Text> : null}
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    minHeight: 36,
  },
  nextLine: {
    flex: 1,
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.primary[700],
  },
  expandButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  fullscreen: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  fullscreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  fullscreenTitle: {
    flex: 1,
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.primary[700],
  },
  fullscreenNotices: {
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.xs,
  },
  wrap: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  map: {
    ...StyleSheet.absoluteFill,
  },
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    alignItems: 'flex-start',
    gap: 2,
    maxWidth: '78%',
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
  controls: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  controlsFull: {
    // In fullscreen the header row above the map holds the exit button; the
    // follow controls drop below it so they never overlap it.
    top: spacing.xl,
  },
  followButton: {
    // 44 dp is the minimum comfortable touch target on both platforms.
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.neutral[300],
  },
  followPressed: {
    backgroundColor: colors.neutral[100],
  },
  followButtonText: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  screenReaderOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  routeNotice: {
    marginTop: spacing.xs,
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
  },
  placeholder: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  placeholderText: {
    color: colors.neutral[600],
    fontSize: typography.fontSizes.sm,
    textAlign: 'center',
  },
});
