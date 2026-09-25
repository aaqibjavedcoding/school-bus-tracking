import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  TripEtaResponse,
  TripStudentAttendanceResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { Badge, KeyValue, SectionTitle } from '../../components';
import {
  formatDistanceMeters,
  formatEtaMinutes,
  formatRelative,
  formatSpeedKmh,
} from '../../lib/format';
import type { LiveFix } from './useLiveTripTracking';
import { t, pluralKey } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { fullName } from '../../lib/format';
import { kidStatusLabel } from '../crew/NextStopKidCard';
import { settledSymbol } from '../crew/manifest-row.ts';

/**
 * Task 22 ETA/progress surfaces, rendered from server-computed data only:
 * the REST ETA snapshot plus `trip:eta:update` pushes. The client never
 * computes a distance or an ETA itself.
 *
 * Every string is a dictionary key (en/hi/mr) — these cards are shared by the
 * crew, parent and admin tracking screens, so the copy moves with the app
 * language everywhere.
 */

/** Compact "where is the bus / what's next" card. */
export const EtaSummaryCard: React.FC<{
  eta: TripEtaResponse | null;
  fix: LiveFix | null;
}> = React.memo(({ eta, fix }) => {
  // Subscribing is what makes a language switch re-render a memoised card.
  useTranslation();

  if (!eta) {
    return (
      <View style={styles.card}>
        <Text style={styles.muted}>{t('eta.noData')}</Text>
      </View>
    );
  }

  const nextStop = eta.next_stop;
  const currentStop = eta.current_stop;
  const hasEta = eta.eta_available;

  return (
    <View style={styles.card}>
      {!hasEta ? (
        <Text style={styles.muted}>{t('eta.waitingFirstFix')}</Text>
      ) : nextStop ? (
        <>
          <View style={styles.row}>
            <Text style={styles.emoji}>📍</Text>
            <Text style={styles.headline} numberOfLines={2}>
              {t('trip.nextStop', { name: nextStop.stop_name })}
            </Text>
          </View>
          <View style={styles.kvRow}>
            <KeyValue
              legible
              label={t('eta.distance')}
              value={formatDistanceMeters(nextStop.distance_meters)}
            />
            <KeyValue
              legible
              label={t('eta.eta')}
              value={formatEtaMinutes(nextStop.eta_minutes) ?? t('eta.unavailable')}
            />
            <KeyValue legible label={t('eta.speed')} value={formatSpeedKmh(eta.speed_kmh)} />
          </View>
        </>
      ) : (
        <Text style={styles.headline}>{t('eta.allDone')}</Text>
      )}
      {currentStop ? (
        <Text style={styles.currentStop}>{t('eta.currentStop', { name: currentStop.stop_name })}</Text>
      ) : null}
      {fix ? <Text style={styles.muted}>{t('eta.lastFix', { time: formatRelative(fix.recorded_at) })}</Text> : null}
    </View>
  );
});
EtaSummaryCard.displayName = 'EtaSummaryCard';

/**
 * Full ordered stop list with per-stop ETA and arrival state.
 *
 * ### Optional kids-per-stop (crew only)
 *
 * `students` — the trip's manifest rows — is passed **only by the crew Stops
 * tab**. With it, each stop row gains an "N kids" badge and expands on tap to
 * the kids assigned there with their PENDING/BOARDED/DROPPED state (N6). The
 * parent and admin surfaces never pass it, so children's names stay off every
 * other screen — the prop's absence is the privacy boundary, not a filter
 * inside a shared list.
 */
export const StopsEtaList: React.FC<{
  eta: TripEtaResponse | null;
  /** Manifest rows for the kids badges + tap-to-expand. Crew only. */
  students?: TripStudentAttendanceResponse[];
}> = React.memo(({ eta, students }) => {
  useTranslation();
  const [expandedStopId, setExpandedStopId] = useState<string | null>(null);

  const kidsByStop = useMemo(() => {
    if (!students || students.length === 0) return null;
    const map = new Map<string, TripStudentAttendanceResponse[]>();
    for (const student of students) {
      const list = map.get(student.stop_id);
      if (list) list.push(student);
      else map.set(student.stop_id, [student]);
    }
    return map;
  }, [students]);

  if (!eta || eta.items.length === 0) {
    return <Text style={styles.muted}>{t('eta.noStopsConfigured')}</Text>;
  }
  return (
    <View style={styles.listWrap}>
      {eta.items.map((stop) => {
        const isNext = eta.next_stop?.stop_id === stop.stop_id;
        const isCurrent = eta.current_stop?.stop_id === stop.stop_id;
        const kids = kidsByStop?.get(stop.stop_id) ?? null;
        const kidCount = kids?.length ?? 0;
        const expanded = expandedStopId === stop.stop_id;
        const expandable = kidsByStop !== null && kidCount > 0;
        return (
          <View key={stop.stop_id}>
            <Pressable
              onPress={expandable ? () => setExpandedStopId(expanded ? null : stop.stop_id) : undefined}
              disabled={!expandable}
              accessibilityRole={expandable ? 'button' : undefined}
              accessibilityState={expandable ? { expanded } : undefined}
              accessibilityLabel={
                expandable
                  ? `${stop.stop_name}, ${t(pluralKey('stops.kidsBadge', kidCount), { count: kidCount })}`
                  : undefined
              }
              style={[styles.stopRow, isNext ? styles.stopRowNext : null]}
            >
              <View style={styles.stopNumber}>
                <Text style={styles.stopNumberText}>{stop.sequence_number}</Text>
              </View>
              <View style={styles.stopMain}>
                <Text style={styles.stopName} numberOfLines={1}>
                  {stop.stop_name}
                </Text>
                <Text style={styles.stopMeta}>
                  {stop.arrived
                    ? t('eta.arrived')
                    : formatEtaMinutes(stop.eta_minutes) !== null
                      ? `${formatEtaMinutes(stop.eta_minutes)} · ${formatDistanceMeters(stop.distance_meters)}`
                      : t('eta.waitingForGps')}
                </Text>
              </View>
              {kidsByStop !== null ? (
                <View style={styles.kidsBadge}>
                  <Text style={styles.kidsBadgeText}>
                    {t(pluralKey('stops.kidsBadge', kidCount), { count: kidCount })}
                  </Text>
                </View>
              ) : null}
              {stop.arrived ? (
                <Badge size="lg" label="✓" tone="success" />
              ) : isNext ? (
                <Badge size="lg" label={t('eta.nextBadge')} tone="warning" />
              ) : isCurrent ? (
                <Badge size="lg" label={t('eta.currentBadge')} tone="info" />
              ) : null}
            </Pressable>
            {expanded && kids ? (
              <View style={styles.kidsList}>
                {kids.map((kid) => (
                  <Text
                    key={kid.student_id}
                    style={styles.kidRow}
                    accessibilityLabel={`${fullName(kid)} · ${t(kidStatusLabel(kid.status))}`}
                  >
                    <Text style={styles.kidMark}>{settledSymbol(kid.status)}</Text>
                    {'  '}
                    {fullName(kid)}
                    {'  ·  '}
                    {t(kidStatusLabel(kid.status))}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
});
StopsEtaList.displayName = 'StopsEtaList';

export const TrackingSection: React.FC<{ title: string }> = ({ title }) => (
  <SectionTitle>{title}</SectionTitle>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  emoji: {
    fontSize: 20,
  },
  headline: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[900],
    flex: 1,
  },
  currentStop: {
    fontSize: 14,
    color: colors.neutral[600],
    fontWeight: '600',
  },
  muted: {
    fontSize: 14,
    color: colors.neutral[500],
  },
  kvRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  listWrap: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  stopRowNext: {
    backgroundColor: '#fffbeb',
  },
  stopNumber: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.neutral[800],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stopNumberText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  stopMain: {
    flex: 1,
    gap: 2,
  },
  stopName: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  stopMeta: {
    fontSize: 14,
    color: colors.neutral[600],
  },
  kidsBadge: {
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  kidsBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[700],
  },
  kidsList: {
    backgroundColor: colors.neutral[50],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 2,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  kidRow: {
    fontSize: 14,
    color: colors.neutral[800],
    paddingVertical: 2,
  },
  kidMark: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[600],
  },
});
