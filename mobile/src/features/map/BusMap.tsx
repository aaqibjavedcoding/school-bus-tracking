import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Feature, Polygon } from 'geojson';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { fixAgeMs } from '../../lib/geo';
import { formatRelative, formatSpeedKmh, formatTime } from '../../lib/format';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import type { ConnectionState, LiveFix } from '../tracking/useLiveTripTracking';
import { accuracyCirclePolygon } from './accuracy-circle';
import { MapIssueLines } from './map-issue-lines';
import { LiveMapSurface } from './LiveMapSurface';
import { useNow } from './useNow';
import { deriveTrackingPresentation, type TrackingPresentation } from './tracking-presentation';

/**
 * The **observer** live-tracking map — parent tracking, admin trip detail,
 * admin tracking, and the conductor's read-only view of their own run.
 *
 * ### One surface, shared
 *
 * Everything the map does — engine and style policy, gesture ownership inside
 * a ScrollView, the follow controls and zoom buttons, fullscreen, the
 * one-layer stops, the next-stop highlight and the arrival-zone ring — is
 * `features/map/LiveMapSurface.tsx` (`variant: 'observer'`), the same
 * component the driver map renders. This wrapper owns only the observer's
 * status panel: GPS freshness in the socket's words ("Live" / "Last known" /
 * "No position"), never the driver's "your device" honesty line, because the
 * position is streamed from the crew device, not produced here.
 *
 * ### Where positions come from, and where they do not
 *
 * The only coordinates this map ever draws are the route's stops (from the API)
 * and GPS fixes streamed over the existing Socket.IO namespace. Between two
 * fixes the marker is *interpolated* — presentation only, so the bus glides
 * instead of teleporting every ~4 s. Interpolated coordinates stay inside the
 * marker: nothing here writes them into tracking history, ETA, attendance or
 * notifications, and the marker never travels past the newest real fix.
 *
 * **Interpolation is not road matching.** Two sparse points are joined by a
 * straight line, so on a bend the bus visibly cuts the corner. The dashed line
 * between stops is the same kind of straight line, and the map says so. See
 * `docs/live-tracking-map.md`.
 *
 * ### The conductor
 *
 * A conductor sees this map read-only: no GPS strip, no location watcher, no
 * stop-marking actions — those are driver surfaces, gated in
 * `crew-map-access.ts`. The conductor's position comes from the observer
 * socket (`useLiveTripTracking`), never from their own phone.
 */
export interface BusMapProps {
  stops: StopResponse[];
  fix: LiveFix | null;
  height?: number;
  busTitle?: string;
  /**
   * Trip identity. Changing it drops the previous bus's rendered position and
   * refits the camera; without it a trip switch would tween the new bus in from
   * wherever the old one was.
   */
  tripId?: string | null;
  /**
   * Socket state, so the map can say "offline" independently of GPS freshness.
   * Defaults to `offline` — the conservative reading for a caller that has not
   * wired it up.
   */
  connection?: ConnectionState;
  /**
   * The next stop's id, from the screen's own ETA derivation — drives the
   * amber highlight and the arrival-zone ring, exactly as on the driver map.
   * `null` (or omitted) draws every stop plain.
   */
  nextStopId?: string | null;
}

// ── Status panel ───────────────────────────────────────────────────────────

/**
 * GPS freshness, kept strictly separate from the socket chip the screens render
 * above the map.
 *
 * A connected socket with a four-minute-old fix reads "Live" on the connection
 * chip and "Last known" here. That pair is the honest one; a single "Live" dot
 * would claim a position the bus stopped reporting.
 */
const MapStatusPanel: React.FC<{
  presentation: TrackingPresentation;
  fix: LiveFix | null;
  now: number;
}> = React.memo(({ presentation, fix, now }) => {
  useTranslation();

  if (presentation.state === 'no-location') {
    return (
      <View style={styles.panel}>
        <Text style={styles.chipTextNeutral}>{t('map.status.noLocation')}</Text>
      </View>
    );
  }

  const live = presentation.state === 'live';
  return (
    <View style={styles.panel}>
      <Text style={live ? styles.chipTextLive : styles.chipTextStale}>
        {live ? t('map.status.live') : t('map.status.lastKnown')}
      </Text>
      {presentation.approximate ? (
        <Text style={styles.chipTextNeutral}>{t('map.status.approximate')}</Text>
      ) : null}
      {fix ? (
        <Text style={styles.panelNote}>
          {presentation.mayReportLiveMotion
            ? t('map.updatedAt', { time: formatRelative(fix.received_at, now) })
            : t('map.staleNote', { time: formatTime(fix.recorded_at) })}
        </Text>
      ) : null}
      {presentation.socketOffline ? (
        <Text style={styles.panelNote}>{t('map.offlineNote')}</Text>
      ) : null}
      {/* Map style/label failures are visible here — never blank-silent. */}
      <MapIssueLines />
    </View>
  );
});
MapStatusPanel.displayName = 'MapStatusPanel';

// ── The map ────────────────────────────────────────────────────────────────

export const BusMap: React.FC<BusMapProps> = ({
  stops,
  fix,
  height = 260,
  busTitle,
  tripId = null,
  connection = 'offline',
  nextStopId = null,
}) => {
  // `t()` reads module state, so subscribing is what makes a language switch
  // re-render this component.
  useTranslation();
  const now = useNow(5_000);

  const presentation = useMemo(
    () =>
      deriveTrackingPresentation({
        fixAgeMs: fix ? fixAgeMs(fix.received_at, now) : null,
        accuracyMeters: fix?.accuracy ?? null,
        socketOffline: connection === 'offline',
      }),
    [fix, connection, now],
  );

  // The ring belongs to the measurement, not the interpolated marker, so it
  // is keyed on the raw fix and the presentation's radius only.
  const accuracyCircleFeature = useMemo<Feature<Polygon> | null>(() => {
    if (!fix || presentation.accuracyCircleMeters === null) return null;
    return accuracyCirclePolygon(
      { latitude: fix.latitude, longitude: fix.longitude },
      presentation.accuracyCircleMeters,
    );
  }, [fix, presentation.accuracyCircleMeters]);

  // Not memoised: `t()` must re-run on a language switch, and a plain string
  // compares equal in the memo below, so this costs nothing.
  const busDescription = !fix
    ? ''
    : presentation.mayReportLiveMotion
      ? // Never describe a speed as current on data that is not current.
        `${formatSpeedKmh(fix.speed)} · ${formatTime(fix.recorded_at)}`
      : `${t('map.status.lastKnown')} · ${formatTime(fix.recorded_at)}`;

  return (
    <LiveMapSurface
      variant="observer"
      stops={stops}
      fix={fix}
      tripId={tripId}
      height={height}
      nextStopId={nextStopId}
      accuracyCircleFeature={accuracyCircleFeature}
      animate={presentation.animate}
      busTitle={busTitle ?? t('map.busA11y')}
      busDescription={busDescription}
      headerTitle={busTitle ?? t('map.busA11y')}
      panel={<MapStatusPanel presentation={presentation} fix={fix} now={now} />}
    />
  );
};

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    maxWidth: '58%',
    backgroundColor: 'rgba(255, 255, 255, 0.94)',
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  chipTextLive: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.secondary[800],
  },
  chipTextStale: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: '#b45309',
  },
  chipTextNeutral: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  panelNote: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
  },
});
