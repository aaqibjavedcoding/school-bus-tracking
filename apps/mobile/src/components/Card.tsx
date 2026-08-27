import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';

export interface CardProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export const Card: React.FC<CardProps> = ({ title, description, children }) => {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children}
    </View>
  );
};

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
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  description: {
    fontSize: 14,
    color: colors.neutral[600],
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
});
