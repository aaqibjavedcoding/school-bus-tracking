import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { StatusBadge } from './StatusBadge';
import { useNetworkStatus } from '../hooks/use-network';

/**
 * Connectivity strip (Task 23 §I): offline vs reconnecting. It *only* reports
 * transport state — attendance/GPS effects are never claimed here, and callers
 * block writes while offline rather than faking success.
 */
export const ConnectionBanner: React.FC<{ socketReconnecting?: boolean }> = ({
  socketReconnecting = false,
}) => {
  const network = useNetworkStatus();
  if (network === 'online' && !socketReconnecting) {
    return null;
  }
  const offline = network === 'offline';
  return (
    <View style={[styles.banner, offline ? styles.offline : styles.reconnecting]}>
      <Text style={styles.text}>
        {offline
          ? 'Offline — changes will not be sent until the connection returns.'
          : 'Reconnecting…'}
      </Text>
      <StatusBadge
        tone={offline ? 'danger' : 'warning'}
        label={offline ? 'OFFLINE' : 'RECONNECTING'}
        compact
      />
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  offline: {
    backgroundColor: '#fee2e2',
  },
  reconnecting: {
    backgroundColor: colors.primary[100],
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[800],
  },
});
