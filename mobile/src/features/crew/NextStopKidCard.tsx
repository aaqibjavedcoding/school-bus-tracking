import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TripAttendanceStatus } from '@school-bus-tracking/shared-types';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { t, pluralKey } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { settledSymbol } from './manifest-row.ts';
import type { NextStopKidsSummary } from './next-stop-kids.ts';

/**
 * "Kids at next stop" — the next-stop slice of the manifest on the trip
 * screen, for BOTH roles (the conductor boards and drops the same kids the
 * driver carries). Data comes from `summarizeNextStopKids` (pure, spec'd);
 * the stop chip reuses the shared `map.stopLabel` template and the status
 * marks reuse the manifest's attendance vocabulary.
 *
 * States, all visible: loading is the parent's `useLoad` (never a fake list),
 * `noNext` (server says the run has no upcoming stop), `none` (a real stop
 * with nobody assigned), the rows (≤ `KID_ROW_WINDOW`) and "+N more".
 */
export const NextStopKidCard: React.FC<{
  summary: NextStopKidsSummary | null;
  /** False while the manifest request is in flight (no fake "no kids"). */
  loaded: boolean;
}> = React.memo(({ summary, loaded }) => {
  useTranslation();

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('trip.kids.title')}</Text>
      {summary === null ? (
        <Text style={styles.muted}>{t('trip.kids.noNext')}</Text>
      ) : (
        <>
          <View style={styles.chip}>
            <Text style={styles.chipText}>
              {t('map.stopLabel', {
                number: summary.sequenceNumber,
                name: summary.stopName,
              })}
            </Text>
          </View>
          {!loaded ? (
            <Text style={styles.muted}>{t('manifest.loading')}</Text>
          ) : summary.total === 0 ? (
            <Text style={styles.muted}>{t('trip.kids.none')}</Text>
          ) : (
            <>
              <Text style={styles.count}>
                {t(pluralKey('trip.kids.count', summary.total), { count: summary.total })}
              </Text>
              {summary.kids.map((kid) => (
                <Text
                  key={kid.studentId}
                  style={styles.row}
                  accessibilityLabel={`${kid.name} · ${t(kidStatusLabel(kid.status))}`}
                >
                  <Text style={styles.mark}>{settledSymbol(kid.status)}</Text>
                  {'  '}
                  {kid.name}
                </Text>
              ))}
              {summary.hiddenCount > 0 ? (
                <Text style={styles.muted}>
                  {t('trip.kids.more', { count: summary.hiddenCount })}
                </Text>
              ) : null}
            </>
          )}
        </>
      )}
    </View>
  );
});
NextStopKidCard.displayName = 'NextStopKidCard';

const STATUS_A11Y = {
  [TripAttendanceStatus.PENDING]: 'manifest.filter.waiting',
  [TripAttendanceStatus.BOARDED]: 'manifest.filter.boarded',
  [TripAttendanceStatus.DROPPED]: 'manifest.filter.dropped',
} as const;

/** The status label of one kid row (a11y/diagnostics; the glyph is visual). */
export function kidStatusLabel(
  status: TripAttendanceStatus,
): (typeof STATUS_A11Y)[TripAttendanceStatus] {
  return STATUS_A11Y[status];
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.neutral[50],
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  chip: {
    alignSelf: 'flex-start',
    backgroundColor: colors.neutral[200],
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    marginBottom: spacing.sm,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  count: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  row: {
    fontSize: 14,
    color: colors.neutral[800],
    paddingVertical: 2,
  },
  mark: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[600],
  },
  muted: {
    fontSize: 14,
    color: colors.neutral[500],
  },
});
