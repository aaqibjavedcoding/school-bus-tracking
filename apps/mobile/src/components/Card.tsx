import React from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';

/** Generic bordered content card used across all role surfaces. */
export const Card: React.FC<{
  title?: string;
  description?: string;
  right?: React.ReactNode;
  children?: React.ReactNode;
  style?: ViewStyle;
}> = ({ title, description, right, children, style }) => (
  <View style={[styles.card, style]}>
    {title || right ? (
      <View style={styles.header}>
        <View style={styles.headerText}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {description ? <Text style={styles.description}>{description}</Text> : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
      </View>
    ) : null}
    {children}
  </View>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: borderRadius.md,
    borderColor: colors.neutral[200],
    borderWidth: 1,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
  },
  right: {
    alignItems: 'flex-end',
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  description: {
    fontSize: 13,
    color: colors.neutral[600],
    marginTop: 2,
  },
});
