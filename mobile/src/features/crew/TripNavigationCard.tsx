import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { StopResponse, TripEtaResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { Button, Card } from '../../components';
import {
  buildDirectionsUrlChunks,
  buildTurnByTurnUrl,
  formatCoordinate,
  type NavigationTarget,
} from '../../lib/navigation';
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
  const router = useRouter();
  const next = derived.nextStop;
  const target = next ? navigationTargetOf(next) : null;

  /**
   * PR 3 — the buttons hand off to real turn-by-turn.
   *
   * `single` starts guidance to the next stop only (on Android via the free
   * navigation intent, which skips the preview screen); `routeChunks` is the
   * rest of the run as waypoints, split into as many links as the URL API
   * allows. Both are plain links: no SDK, no key, no metered request.
   */
  const single = target ? buildTurnByTurnUrl(target, Platform.OS) : null;

  const routeChunks = useMemo(() => {
    if (!target || !next) return [];
    const later: NavigationTarget[] = [...stops]
      .sort((a, b) => a.sequence_number - b.sequence_number)
      .filter((stop) => stop.sequence_number > next.sequence_number)
      .map((stop) => navigationTargetOf(stop))
      .filter((candidate): candidate is NavigationTarget => candidate !== null);
    return buildDirectionsUrlChunks({ destination: target, waypoints: later, travelmode: 'driving' });
  }, [stops, next, target]);

  /**
   * Coming back from the map app with kids still unmarked.
   *
   * The crew leaves the app to drive and returns at the kerb; the one thing
   * that is easy to forget then is attendance. So the card remembers that it
   * launched a map link, and when the app becomes active again it shows a
   * small prompt (never a blocking modal) that jumps straight to the manifest
   * for that stop. It only appears when there is something to do — pending
   * kids at the stop the driver just drove to.
   */
  const launchedRef = useRef(false);
  const [returnedFromMaps, setReturnedFromMaps] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && launchedRef.current) {
        launchedRef.current = false;
        setReturnedFromMaps(true);
      }
    });
    return () => subscription.remove();
  }, []);

  // A new stop clears the prompt — it always refers to the current stop.
  useEffect(() => {
    setReturnedFromMaps(false);
  }, [next?.id]);

  const openLink = useCallback(
    async (link: string, fallback?: string | null) => {
      launchedRef.current = true;
      try {
        await Linking.openURL(link);
      } catch {
        if (fallback && fallback !== link) {
          try {
            await Linking.openURL(fallback);
            return;
          } catch {
            /* fall through to the message below */
          }
        }
        launchedRef.current = false;
        Alert.alert(t('navigate.card.title'), t('navigate.card.openFailed'));
      }
    },
    [],
  );

  const showAttendancePrompt =
    returnedFromMaps && Boolean(next) && (kidsSummary?.pendingCount ?? 0) > 0;

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
          {single ? (
            <Button
              label={t('navigate.card.buttonNext')}
              icon="navigate"
              variant="primary"
              size="field"
              onPress={() => void openLink(single, routeChunks[0] ?? null)}
              style={styles.action}
            />
          ) : null}
          {routeChunks.length > 0 ? (
            <Button
              label={t('navigate.card.buttonRoute')}
              icon="map"
              variant="secondary"
              size="field"
              onPress={() => void openLink(routeChunks[0])}
              style={styles.action}
            />
          ) : null}
          {routeChunks.length > 1 ? (
            <Text style={styles.muted}>
              {t('navigate.card.routeParts', { index: 1, total: routeChunks.length })}
            </Text>
          ) : null}
          {showAttendancePrompt && next ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('navigate.attendance.action')}
              onPress={() => {
                setReturnedFromMaps(false);
                router.push({ pathname: '/manifest', params: { stopId: next.id } });
              }}
              style={styles.prompt}
            >
              <Ionicons name="people" size={18} color={colors.primary[700]} />
              <View style={styles.promptText}>
                <Text style={styles.promptTitle}>{t('navigate.attendance.title')}</Text>
                <Text style={styles.promptBody}>
                  {t(
                    pluralKey('navigate.attendance.body', kidsSummary?.pendingCount ?? 0),
                    { count: kidsSummary?.pendingCount ?? 0, stop: next.name },
                  )}
                </Text>
              </View>
              <Text style={styles.promptAction}>{t('navigate.attendance.action')}</Text>
            </Pressable>
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
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  promptText: {
    flex: 1,
  },
  promptTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  promptBody: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[700],
  },
  promptAction: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.primary[700],
  },
});
