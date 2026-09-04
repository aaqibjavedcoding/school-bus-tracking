import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import type { ConnectionState } from './useLiveTripTracking';

/**
 * Live/reconnecting/offline chip shared by the crew, parent and admin
 * tracking surfaces. `live` mirrors the Socket.IO connection state, not a
 * heartbeat the client invents.
 */
export const ConnectionIndicator: React.FC<{ connection: ConnectionState }> = ({ connection }) => {
  const tone =
    connection === 'live'
      ? { bg: '#dcfce7', text: colors.secondary[800] }
      : connection === 'reconnecting'
        ? { bg: '#fef3c7', text: '#b45309' }
        : { bg: '#fee2e2', text: '#b91c1c' };
  return (
    <View style={[styles.chip, { backgroundColor: tone.bg }]}>
      <Text style={[styles.text, { color: tone.text }]}>
        {connection === 'live'
          ? '● Live'
          : connection === 'reconnecting'
            ? '● Reconnecting…'
            : '● Offline'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: borderRadius.full,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: typography.fontSizes.xs,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
});
