import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

export const StatCard: React.FC<{
  label: string;
  value: string | number;
  tone?: 'default' | 'warning';
}> = ({ label, value, tone = 'default' }) => (
  <View style={[styles.card, tone === 'warning' && styles.cardWarning]}>
    <Text style={styles.value}>{value}</Text>
    <Text style={styles.label}>{label}</Text>
  </View>
);

/** Compact horizontal stats strip used by dashboards. */
export const StatGrid: React.FC<{ items: Array<{ label: string; value: string | number }> }> = ({
  items,
}) => (
  <View style={styles.grid}>
    {items.map((item) => (
      <StatCard key={item.label} {...item} />
    ))}
  </View>
);

export const SectionTitle: React.FC<{ title: string; right?: React.ReactNode }> = ({
  title,
  right,
}) => (
  <View style={styles.sectionRow}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {right}
  </View>
);

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  card: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.neutral[200],
    padding: spacing.sm,
    alignItems: 'center',
  },
  cardWarning: {
    borderColor: colors.primary[300],
    backgroundColor: colors.primary[50],
  },
  value: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  label: {
    fontSize: 11,
    color: colors.neutral[600],
    marginTop: 2,
    textAlign: 'center',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.neutral[800],
  },
});
