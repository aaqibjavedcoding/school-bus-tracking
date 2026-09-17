import React from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';

export interface CardProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
  /**
   * The deliberate-reading variant used on crew screens: a 20px title, 16px
   * description and roomier padding. Dense admin cards leave it off.
   */
  legible?: boolean;
}

export const Card: React.FC<CardProps> = ({ title, description, children, legible = false }) => {
  return (
    <View style={[styles.card, legible ? styles.cardLegible : null]}>
      <Text style={[styles.title, legible ? styles.titleLegible : null]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, legible ? styles.descriptionLegible : null]}>
          {description}
        </Text>
      ) : null}
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
    padding: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  cardLegible: {
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  title: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.xs,
  },
  titleLegible: {
    fontSize: typography.fontSizes.base,
  },
  description: {
    fontSize: 13,
    color: colors.neutral[600],
    lineHeight: 18,
    marginBottom: spacing.xs,
  },
  descriptionLegible: {
    fontSize: typography.fontSizes.sm,
    lineHeight: 20,
  },
});
