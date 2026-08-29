import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { useParentNotifications } from '../../src/features/parent/NotificationsProvider';
import { notificationTypeLabel } from '../../src/features/parent/notifications-state';
import { Button, EmptyState, LoadingView, Screen } from '../../src/components';
import { formatDateTime } from '../../src/lib/format';

/**
 * Parent notification centre: the persisted history plus live
 * `notification:new` pushes over the `/notifications` socket. Tapping an
 * unread row marks it read (only after the API confirms); the tab badge
 * follows the same unread count.
 */
export default function ParentNotificationsScreen() {
  const { state, loading, connected, markRead, markAllRead, refresh } = useParentNotifications();

  return (
    <Screen refresh={() => void refresh()} refreshing={loading}>
      <View style={styles.headerRow}>
        <Text style={styles.connected}>{connected ? '● Live' : '● Reconnecting…'}</Text>
        {state.unreadCount > 0 ? (
          <Button
            label={`Mark all read (${state.unreadCount})`}
            small
            variant="ghost"
            onPress={() => void markAllRead()}
          />
        ) : null}
      </View>

      {loading && state.recent.length === 0 ? (
        <LoadingView label="Loading notifications…" />
      ) : state.recent.length === 0 ? (
        <EmptyState
          title="No notifications yet"
          description="Boarding, drop-off, trip and stop-arrival alerts for your children arrive here in realtime."
        />
      ) : (
        state.recent.map((item) => (
          <Pressable
            key={item.id}
            onPress={() => {
              if (!item.is_read) {
                void markRead(item.id);
              }
            }}
            style={[styles.row, item.is_read ? null : styles.rowUnread]}
          >
            <View style={styles.rowTop}>
              <Text style={styles.type}>{notificationTypeLabel(item.type)}</Text>
              {!item.is_read ? <View style={styles.unreadDot} /> : null}
            </View>
            <Text style={styles.title}>{item.title}</Text>
            <Text style={styles.message}>{item.message}</Text>
            <Text style={styles.time}>{formatDateTime(item.created_at)}</Text>
          </Pressable>
        ))
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  connected: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.xs,
    fontWeight: '700',
  },
  row: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderLeftWidth: 4,
    borderLeftColor: colors.neutral[200],
    borderRadius: borderRadius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: 4,
  },
  rowUnread: {
    borderLeftColor: colors.primary[500],
    backgroundColor: '#fffbeb',
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  type: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    fontWeight: '700',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary[500],
  },
  title: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  message: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
  time: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[400],
    marginTop: 2,
  },
});
