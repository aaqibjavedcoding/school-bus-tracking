import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';

/**
 * The labelled replacement for the native map surface on runtimes where the
 * map provider cannot exist — today: the Expo Go app on Android, where Google
 * Maps stopped shipping in SDK 53 and `react-native-maps` draws a blank box.
 *
 * It says **what is missing and why** instead of showing an empty map, and it
 * deliberately does not claim anything about the trip: the route, the stops
 * and GPS sharing all keep working, and the screens' own status lines say how
 * they are doing. The copy is i18n (`map.needsDevBuildTitle/Body`), never a
 * literal.
 */
export const NeedsDevBuildPanel: React.FC = () => {
  // Subscribe so a language switch re-renders the panel (t() reads module
  // state, exactly like the rest of this codebase).
  useTranslation();

  return (
    <View style={styles.surface} testID="map-needs-dev-build">
      <Text style={styles.title}>{t('map.needsDevBuildTitle')}</Text>
      <Text style={styles.body}>{t('map.needsDevBuildBody')}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  surface: {
    // Fills the map's box (`StyleSheet.absoluteFill` where the MapView sat),
    // then centres its own content.
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.neutral[100],
    alignItems: 'center',
    justifyContent: 'center',
    // Clear of the absolute status panel the parent maps keep (top-left).
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: {
    color: colors.neutral[800],
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    textAlign: 'center',
  },
  body: {
    marginTop: spacing.xs,
    color: colors.neutral[600],
    fontSize: typography.fontSizes.sm,
    textAlign: 'center',
  },
});
