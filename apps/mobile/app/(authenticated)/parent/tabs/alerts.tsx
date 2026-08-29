import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { spacing } from '@school-bus-tracking/design-tokens';
import {
  NotificationReadFilter,
  type NotificationResponse,
} from '@school-bus-tracking/shared-types';
import { Screen } from '../../../../src/components/Screen';
import { ListRow } from '../../../../src/components/ListRow';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { EmptyState, ErrorBanner } from '../../../../src/components/Feedback';
import { RefreshList } from '../../../../src/components/RefreshList';
import { Button } from '../../../../src/components/Button';
import { Segmented } from '../../../../src/components/GpsStatus';
import { useToast } from '../../../../src/components/Toast';
import { useParentNotifications } from '../../../../src/features/parent/use-parent-notifications';
import { formatDateTime } from '../../../../src/utils/format';

const FILTERS = ['All', 'Unread', 'Read'] as const;
type FilterIndex = 0 | 1 | 2;

const TYPE_ICONS: Partial<Record<string, string>> = {
  STUDENT_BOARDED: '🚌',
  STUDENT_DROPPED: '🏁',
  TRIP_BOARDING: '🕐',
  TRIP_IN_PROGRESS: '🛣️',
  TRIP_COMPLETED: '✅',
  TRIP_CANCELLED: '🚫',
  STOP_ARRIVED: '📍',
};

/**
 * Parent alerts (Task 23 §G, reusing Task 21): unread count, list, mark one
 * read, mark all read — REST for state, the `/notifications` socket for live
 * arrivals. Nothing here stores read-state locally.
 */
export default function ParentAlertsScreen() {
  const [filter, setFilter] = useState<FilterIndex>(0);
  const toast = useToast();
  const status =
    filter === 1
      ? NotificationReadFilter.UNREAD
      : filter === 2
        ? NotificationReadFilter.READ
        : 'all';
  const notifications = useParentNotifications(status);

  const onTap = async (item: NotificationResponse): Promise<void> => {
    if (item.is_read) {
      return;
    }
    const ok = await notifications.markRead(item.id);
    toast.show(
      ok ? 'Marked as read.' : 'The server could not update that notification.',
      ok ? 'success' : 'danger',
    );
  };

  const markAll = async (): Promise<void> => {
    const count = await notifications.markAllRead();
    if (count < 0) {
      toast.show('Could not reach the server.', 'danger');
      return;
    }
    toast.show(count === 0 ? 'Nothing to mark.' : `${count} marked as read.`, 'success');
  };

  return (
    <Screen scroll={false}>
      <View style={styles.headerRow}>
        <Segmented
          options={[...FILTERS]}
          selected={filter}
          onSelect={(index) => setFilter(index as FilterIndex)}
        />
        {notifications.unread > 0 ? (
          <Button
            label={`Mark all read (${notifications.unread})`}
            small
            variant="secondary"
            onPress={() => void markAll()}
          />
        ) : null}
      </View>
      {notifications.error ? (
        <ErrorBanner message={notifications.error} onRetry={() => void notifications.refresh()} />
      ) : null}
      <RefreshList<NotificationResponse>
        data={notifications.items}
        loading={notifications.loading}
        refreshing={notifications.refreshing}
        error={notifications.error}
        onRefresh={() => void notifications.refresh()}
        emptyTitle="No alerts"
        emptyMessage="Boarding, arrivals, trip changes and cancellations will show up here."
        skeleton
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ListRow
            title={item.title}
            subtitle={item.message}
            meta={formatDateTime(item.created_at)}
            onPress={() => void onTap(item)}
            right={
              <View style={styles.badges}>
                {item.stop_id ? (
                  <StatusBadge tone="info" label={TYPE_ICONS.STOP_ARRIVED ?? ''} compact />
                ) : null}
                {!item.is_read ? <StatusBadge tone="warning" label="NEW" compact /> : null}
                <Text style={styles.icon}>{TYPE_ICONS[item.type] ?? '🔔'}</Text>
              </View>
            }
          />
        )}
      />
      {notifications.items.length === 0 && !notifications.loading && !notifications.error ? (
        <EmptyState title="No alerts" message="You’re all caught up." icon="🔕" />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badges: {
    alignItems: 'flex-end',
    gap: 2,
  },
  icon: {
    fontSize: 18,
  },
});
