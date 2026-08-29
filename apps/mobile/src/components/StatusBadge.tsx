import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<BadgeTone, { bg: string; fg: string; dot: string }> = {
  neutral: { bg: colors.neutral[100], fg: colors.neutral[700], dot: colors.neutral[500] },
  info: { bg: '#e0f2fe', fg: '#0369a1', dot: '#0284c7' },
  success: { bg: colors.secondary[100], fg: colors.secondary[800], dot: colors.secondary[600] },
  warning: { bg: colors.primary[100], fg: colors.primary[800], dot: colors.primary[600] },
  danger: { bg: '#fee2e2', fg: '#991b1b', dot: '#dc2626' },
};

export interface StatusBadgeProps {
  tone?: BadgeTone;
  label: string;
  compact?: boolean;
  style?: ViewStyle;
}

/** Clear status pill with a leading tone dot (used for trips, GPS, sync…). */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
  tone = 'neutral',
  label,
  compact,
  style,
}) => {
  const t = TONES[tone];
  return (
    <View style={[styles.badge, compact && styles.compact, { backgroundColor: t.bg }, style]}>
      <View style={[styles.dot, { backgroundColor: t.dot }]} />
      <Text style={[styles.text, { color: t.fg }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  compact: {
    paddingVertical: 2,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  text: {
    fontSize: 12,
    fontWeight: '700',
  },
});
