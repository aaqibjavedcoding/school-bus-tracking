import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import type { ConnectionState } from './useLiveTripTracking';
import { useTranslation } from '../../lib/i18n-provider';
import { t } from '../../lib/i18n.ts';

/**
 * Live/reconnecting/offline chip shared by the crew, parent and admin
 * tracking surfaces. `live` mirrors the Socket.IO connection state, not a
 * heartbeat the client invents.
 */
export const ConnectionIndicator: React.FC<{ connection: ConnectionState }> = React.memo(
  ({ connection }) => {
    // `React.memo` does not block a context update, so subscribing here is what
    // keeps this chip in step with a language switch.
    useTranslation();
    const tone =
      connection === 'live'
        ? { bg: '#dcfce7', text: colors.secondary[800] }
        : connection === 'reconnecting'
          ? { bg: '#fef3c7', text: '#b45309' }
          : { bg: '#fee2e2', text: '#b91c1c' };
    return (
      <View style={[styles.chip, { backgroundColor: tone.bg }]}>
        <Text style={[styles.text, { color: tone.text }]}>{connectionLabel(connection)}</Text>
      </View>
    );
  },
);
ConnectionIndicator.displayName = 'ConnectionIndicator';

/** Kept outside the component so the pure mapping is testable. */
export function connectionLabel(connection: ConnectionState): string {
  if (connection === 'live') return t('connection.live');
  if (connection === 'reconnecting') return t('connection.reconnecting');
  return t('connection.offline');
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
