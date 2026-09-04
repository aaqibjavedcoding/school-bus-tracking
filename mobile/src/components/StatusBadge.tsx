import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';

export interface StatusBadgeProps {
  status: 'operational' | 'ready' | 'pending';
  label: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label }) => {
  const getColors = () => {
    switch (status) {
      case 'operational':
        return {
          bg: '#dcfce7',
          text: colors.secondary[800],
          dot: colors.secondary[600],
        };
      case 'ready':
        return {
          bg: '#e0f2fe',
          text: '#0369a1',
          dot: '#0284c7',
        };
      case 'pending':
      default:
        return {
          bg: colors.neutral[100],
          text: colors.neutral[700],
          dot: colors.neutral[500],
        };
    }
  };

  const currentColors = getColors();

  return (
    <View style={[styles.badge, { backgroundColor: currentColors.bg }]}>
      <View style={[styles.dot, { backgroundColor: currentColors.dot }]} />
      <Text style={[styles.text, { color: currentColors.text }]}>{label}</Text>
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
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: spacing.xs,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
  },
});
