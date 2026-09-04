import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { useParentNotifications } from '../../src/features/parent/NotificationsProvider';
import { notificationTypeLabel } from '../../src/features/parent/notifications-state';
import {
  Button,
  EmptyState,
  FilterChips,
  ListScreen,
  LoadingView,
  SearchBar,
} from '../../src/components';
import { formatDateTime } from '../../src/lib/format';

/**
 * Parent notification centre: the persisted history plus live
 * `notification:new` pushes over the `/notifications` socket. Tapping an
 * unread row marks it read (only after the API confirms); the tab badge
 * follows the same unread count.
 */
export default function ParentNotificationsScreen() {
  const { state, loading, connected, markRead, markAllRead, refresh } = useParentNotifications();
  const [search, setSearch] = useState('');
  const [readFilter, setReadFilter] = useState<'ALL' | 'UNREAD' | 'READ'>('ALL');

  const term = search.trim().toLowerCase();
  const visible = useMemo(() => {
    let rows = state.recent;
    if (readFilter !== 'ALL') {
      const wantRead = readFilter === 'READ';
      rows = rows.filter((item) => item.is_read === wantRead);
    }
    if (term) {
      rows = rows.filter((item) =>
        [item.title, item.message, notificationTypeLabel(item.type)].some((value) =>
          value.toLowerCase().includes(term),
        ),
      );
    }
    return rows;
  }, [state.recent, readFilter, term]);

  const filtersActive = readFilter !== 'ALL' || term.length > 0;
  const resetFilters = () => {
    setReadFilter('ALL');
    setSearch('');
  };

  return (
    <ListScreen
      data={visible}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <Pressable
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
      )}
      header={
        <>
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
          {state.recent.length > 0 ? (
            <>
              <SearchBar
                value={search}
                onChangeText={setSearch}
                onClear={() => setSearch('')}
                placeholder="Search notifications…"
              />
              <FilterChips<'ALL' | 'UNREAD' | 'READ'>
                options={[
                  { value: 'ALL', label: `All · ${state.recent.length}` },
                  { value: 'UNREAD', label: `Unread · ${state.unreadCount}` },
                  {
                    value: 'READ',
                    label: `Read · ${state.recent.length - state.unreadCount}`,
                  },
                ]}
                value={readFilter}
                onChange={setReadFilter}
              />
            </>
          ) : null}
        </>
      }
      empty={
        loading && state.recent.length === 0 ? (
          <LoadingView label="Loading notifications…" />
        ) : (
          <EmptyState
            title={filtersActive ? 'No matching notifications' : 'No notifications yet'}
            description={
              filtersActive
                ? 'No notifications match the current search or filter.'
                : 'Boarding, drop-off, trip and stop-arrival alerts for your children arrive here in realtime.'
            }
            action={
              filtersActive ? (
                <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
              ) : null
            }
          />
        )
      }
      refresh={() => void refresh()}
      refreshing={loading}
    />
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
