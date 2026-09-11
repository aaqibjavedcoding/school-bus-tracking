import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ReportSummaryCard } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { formatReportCount } from '../../../lib/reports';

/**
 * Summary figures of a report (or of the reports landing page) as a responsive
 * two-column card grid — the mobile counterpart of the web `stat-grid`.
 */
export const StatGrid: React.FC<{ cards: ReportSummaryCard[] }> = ({ cards }) => (
  <View style={styles.grid}>
    {cards.map((card) => (
      <View key={card.key} style={styles.stat}>
        <Text style={styles.value}>{formatReportCount(card.value)}</Text>
        <Text style={styles.label}>{card.label}</Text>
        {card.hint ? <Text style={styles.hint}>{card.hint}</Text> : null}
      </View>
    ))}
  </View>
);

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  stat: {
    flexBasis: '47%',
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  value: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  label: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[700],
    marginTop: 2,
  },
  hint: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
});
