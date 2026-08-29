import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { StatusBadge } from './StatusBadge';
import { GPS_STATUS_LABELS, gpsStatusTone, type GpsStatus } from '../gps/status';

export const GpsStatusBadge: React.FC<{
  status: GpsStatus;
  style?: React.ComponentProps<typeof StatusBadge>['style'];
}> = ({ status, style }) => (
  <StatusBadge tone={gpsStatusTone(status)} label={GPS_STATUS_LABELS[status]} style={style} />
);

/** Two-tone segmented control for small view switches (Today | Upcoming). */
export const Segmented: React.FC<{
  options: string[];
  selected: number;
  onSelect: (index: number) => void;
}> = ({ options, selected, onSelect }) => (
  <View style={styles.row}>
    {options.map((option, index) => (
      <Pressable
        key={option}
        accessibilityRole="tab"
        accessibilityState={{ selected: index === selected }}
        onPress={() => onSelect(index)}
        style={[styles.segment, index === selected && styles.segmentActive]}
      >
        <Text style={[styles.label, index === selected && styles.labelActive]}>{option}</Text>
      </Pressable>
    ))}
  </View>
);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    padding: 3,
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
  },
  segment: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: borderRadius.sm,
    minHeight: 40,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[600],
  },
  labelActive: {
    color: colors.neutral[900],
  },
});
