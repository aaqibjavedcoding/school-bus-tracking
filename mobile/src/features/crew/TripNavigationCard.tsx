import React, { useMemo } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StopResponse, TripEtaResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { Button, Card } from '../../components';
import { buildNavigationUrl, formatCoordinate } from '../../lib/navigation';
import {
  formatDistanceMeters,
  formatEtaMinutes,
} from '../../lib/format';
import { deriveTripProgress, navigationTargetOf } from './navigation-stop';
import { pluralKey, t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { NextStopKidRows } from './NextStopKidCard';
import type { NextStopKidsSummary } from './next-stop-kids.ts';

/**
 * The next-stop card (Task 44, hardened 3E, reworked N3/N6).
 *
 * The platform has no routing service of its own and adding a paid directions
 * API is out of scope, so navigation is a **hand-off**: the card shows the
 * stop the server computed as next and opens it in the phone's own map
 * application with a plain maps URL. No key, no account, nothing leaves the
 * device beyond the destination the driver can already see.
 *
 * A stop that has not been geofenced yet simply has no Navigate button — the
 * app never sends anyone to a guessed coordinate.
 *
 * ### What the card answers, in one glance (N3)
 *
 * - **which stop** — the name, big;
 * - **how far along the run** — "Stop 4 of 8" (the stop's own sequence
 *   number against the route's stop count);
 * - **how far / how long** — the server's `eta.next_stop` distance and ETA
 *   minutes, never a client estimate;
 * - **who is waiting** — the same `summarizeNextStopKids` slice the conductor
 *   reads, rendered as the count line plus {@link NextStopKidRows}: one block,
 *   one heading, the names under the facts (N6). The old "Trip {id} · N
 *   stops" meta line (a truncated trip id) is gone — it was diagnostics, not
 *   something a driver reads at a kerb. The lat/long stays, one small muted
 *   line, because support sometimes needs to read it aloud.
 *
 * 3E: uses `deriveTripProgress` — monotonic frontier, nearest-upcoming by
 * distance when available, never backward/random. Diagnostics are logged via
 * `crew-diagnostics` (support-facing), not shown to driver.
 */

export interface TripNavigationCardProps {
  /** Ordered stops of the trip's route. */
  stops: StopResponse[];
  /** Stop id the server currently reports as next, when known. */
  nextStopId?: string | null;
  /** Full ETA response for robust derivation (frontier + distances). */
  eta?: TripEtaResponse | null;
  /** Previous frontier for monotonic guarantee (persisted in parent if needed). */
  previousFrontier?: number;
  /**
   * The next-stop manifest slice (the kids card's own data) — renders the
   * "N kids waiting here" line and the names inside this block. `null` while
   * there is no next stop.
   */
  kidsSummary?: NextStopKidsSummary | null;
  /** False while the manifest request is in flight (no fake "no kids"). */
  kidsLoaded?: boolean;
}

export const TripNavigationCard: React.FC<TripNavigationCardProps> = ({
  stops,
  nextStopId,
  eta = null,
  previousFrontier,
  kidsSummary = null,
  kidsLoaded = true,
}) => {
  useTranslation();
  const derived = useMemo(
    () => deriveTripProgress(stops, eta ?? null, nextStopId ?? null, previousFrontier),
    [stops, eta, nextStopId, previousFrontier],
  );
  const next = derived.nextStop;
  const target = next ? navigationTargetOf(next) : null;
  const url = target ? buildNavigationUrl(target) : null;

  const distanceEta = next
    ? [
        eta?.next_stop?.distance_meters != null
          ? formatDistanceMeters(eta.next_stop.distance_meters)
          : null,
        formatEtaMinutes(eta?.next_stop?.eta_minutes ?? null),
      ]
        .filter((part): part is string => part !== null)
        .join(' · ')
    : '';

  const kidsLine = (() => {
    if (!kidsSummary || kidsSummary.total === 0) return null;
    if (!kidsLoaded) return t('manifest.loading');
    return kidsSummary.pendingCount > 0
      ? t(pluralKey('navigate.card.kidsWaiting', kidsSummary.pendingCount), {
          count: kidsSummary.pendingCount,
        })
      : t('navigate.card.kidsDone');
  })();

  return (
    <Card legible title={t('navigate.card.title')} description={t('navigate.card.description')}>
      {next && target ? (
        <View style={styles.block}>
          <View style={styles.row}>
            <Ionicons name="navigate" size={18} color={colors.primary[600]} />
            <Text style={styles.stopName}>{next.name}</Text>
          </View>
          <Text style={styles.stopOf}>
            {t('navigate.card.stopOf', { position: next.sequence_number, total: stops.length })}
          </Text>
          {distanceEta.length > 0 ? (
            <Text style={styles.distanceEta}>{distanceEta}</Text>
          ) : (
            <Text style={styles.muted}>{t('eta.waitingForGps')}</Text>
          )}
          {kidsLine ? <Text style={styles.kidsLine}>{kidsLine}</Text> : null}
          {kidsSummary && kidsSummary.total > 0 ? (
            <NextStopKidRows summary={kidsSummary} />
          ) : null}
          <Text style={styles.coords}>{formatCoordinate(target.latitude, target.longitude)}</Text>
          {url ? (
            <Button
              label={t('navigate.card.button')}
              icon="navigate"
              variant="secondary"
              size="field"
              onPress={() => void Linking.openURL(url)}
              style={styles.action}
            />
          ) : null}
        </View>
      ) : (
        <Text style={styles.muted}>
          {stops.length === 0 ? t('navigate.card.noStops') : t('navigate.card.noGeofence')}
        </Text>
      )}
    </Card>
  );
};

const styles = StyleSheet.create({
  block: {
    gap: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stopName: {
    flex: 1,
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  stopOf: {
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  distanceEta: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.primary[700],
  },
  kidsLine: {
    fontSize: typography.fontSizes.base,
    fontWeight: '600',
    color: colors.neutral[900],
    marginTop: spacing.xs,
  },
  coords: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  muted: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
    borderRadius: borderRadius.md,
  },
});
