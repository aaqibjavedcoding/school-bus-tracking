import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import { TripAttendanceStatus, TripStatus } from '@school-bus-tracking/shared-types';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { ErrorBanner, LoadingView } from '../../../../src/components/Feedback';
import { ConnectionBanner } from '../../../../src/components/ConnectionBanner';
import { useAuth } from '../../../../src/auth/auth-context';
import { useParentHome } from '../../../../src/features/parent/use-parent-home';
import {
  attendanceStatusLabelFor,
  formatTime,
  tripStatusTone,
  TRIP_STATUS_LABELS,
} from '../../../../src/utils/format';
import { useNotificationStream } from '../../../../src/socket/use-notifications';
import { NOTIFICATION_EVENTS } from '@school-bus-tracking/shared-types';

/**
 * Parent home (Task 23 §G): children + today's trip + boarding/drop status +
 * unread alerts — all from `/parent/dashboard` and `/parent/notifications`,
 * the same endpoints the web portal uses.
 */
export default function ParentHome() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const home = useParentHome();
  const [liveUnread, setLiveUnread] = React.useState(0);

  useNotificationStream((event) => {
    if (!event) return;
    setLiveUnread((count) => count + 1);
    void NOTIFICATION_EVENTS.new; // documents the event this stream is subscribed to
  });

  if (home.loading && !home.data) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Loading your family…" />
      </Screen>
    );
  }

  const children = home.data?.children ?? [];
  const unread = (home.data?.unread ?? 0) + liveUnread;

  return (
    <Screen>
      <ConnectionBanner />
      <Card>
        <Text style={styles.hello}>Hello, {user ? user.first_name : 'there'} 👋</Text>
        {home.data?.school ? (
          <Text style={styles.school}>
            {home.data.school.name} · code {home.data.school.code}
          </Text>
        ) : null}
        <View style={styles.quickRow}>
          <Pressable
            accessibilityRole="button"
            style={styles.quickChip}
            onPress={() => router.push('/(authenticated)/parent/tabs/alerts' as never)}
          >
            <Text style={styles.quickChipText}>
              🔔 {unread > 0 ? `${unread} unread` : 'Alerts'}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            style={styles.quickChip}
            onPress={() => void logout()}
          >
            <Text style={styles.quickChipText}>Sign out</Text>
          </Pressable>
        </View>
      </Card>

      {home.error ? <ErrorBanner message={home.error} onRetry={() => void home.refresh()} /> : null}

      <Text style={styles.section}>Today</Text>
      {children.length === 0 ? (
        <Card>
          <Text style={styles.emptyText}>
            No children are linked to your account yet. Ask your school admin to connect your
            child's admission record to this login.
          </Text>
        </Card>
      ) : (
        children.map((child) => {
          const trip = child.today?.trip ?? null;
          const attendance = child.today?.attendance ?? null;
          const bus = child.today?.bus ?? null;
          return (
            <Card key={child.id} style={styles.childCard}>
              <View style={styles.childHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>
                    {child.first_name} {child.last_name}
                  </Text>
                  <Text style={styles.childMeta}>
                    {child.grade_level ? `Grade ${child.grade_level} · ` : ''}
                    {child.home_stop?.name ? `Stop: ${child.home_stop.name}` : 'No home stop set'}
                  </Text>
                </View>
                {trip ? (
                  <StatusBadge
                    tone={tripStatusTone(trip.status)}
                    label={TRIP_STATUS_LABELS[trip.status]}
                    compact
                  />
                ) : (
                  <StatusBadge tone="neutral" label="No trip today" compact />
                )}
              </View>

              {trip ? (
                <View style={styles.childFacts}>
                  <Text style={styles.childFact}>
                    {bus
                      ? `${bus.bus_number ? `Bus ${bus.bus_number} · ` : ''}${bus.registration_number}`
                      : 'Bus assignment pending'}
                  </Text>
                  <Text style={styles.childFact}>
                    Scheduled {formatTime(trip.scheduled_start_at)}
                    {trip.actual_start_at ? ` · departed ${formatTime(trip.actual_start_at)}` : ''}
                  </Text>
                  {trip.status === TripStatus.IN_PROGRESS || trip.status === TripStatus.BOARDING ? (
                    <Pressable
                      accessibilityRole="button"
                      style={styles.trackButton}
                      onPress={() =>
                        router.push({
                          pathname: '/(authenticated)/parent/tabs/tracking',
                          params: { childId: child.id },
                        } as never)
                      }
                    >
                      <Text style={styles.trackButtonText}>Track the bus live →</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.statusRow}>
                <StatusBadge
                  tone={
                    attendance
                      ? attendance.status === TripAttendanceStatus.BOARDED
                        ? 'success'
                        : attendance.status === TripAttendanceStatus.DROPPED
                          ? 'info'
                          : 'neutral'
                      : 'neutral'
                  }
                  label={
                    attendance
                      ? `${attendanceStatusLabelFor(attendance.status)}${attendance.boarded_at ? ` · ${formatTime(attendance.boarded_at)}` : ''}${attendance.dropped_at ? ` · ${formatTime(attendance.dropped_at)}` : ''}`
                      : 'Awaiting boarding'
                  }
                  compact
                />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/parent/children/${child.id}` as never)}
                  hitSlop={8}
                >
                  <Text style={styles.detailLink}>Details</Text>
                </Pressable>
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hello: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  school: {
    fontSize: 13,
    color: colors.neutral[600],
    marginTop: 2,
  },
  quickRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  quickChip: {
    backgroundColor: colors.neutral[100],
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 36,
    justifyContent: 'center',
  },
  quickChipText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.neutral[700],
  },
  section: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.neutral[800],
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
  childCard: {
    borderLeftWidth: 4,
    borderLeftColor: colors.primary[500],
  },
  childHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  childName: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  childMeta: {
    fontSize: 12,
    color: colors.neutral[600],
    marginTop: 2,
  },
  childFacts: {
    gap: 2,
    marginBottom: spacing.sm,
  },
  childFact: {
    fontSize: 13,
    color: colors.neutral[600],
  },
  trackButton: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.primary[100],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 40,
    justifyContent: 'center',
  },
  trackButtonText: {
    color: colors.primary[800],
    fontWeight: '800',
    fontSize: 13,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xs,
  },
  detailLink: {
    color: colors.primary[700],
    fontWeight: '700',
    fontSize: 13,
    padding: spacing.xs,
  },
  emptyText: {
    fontSize: 13,
    color: colors.neutral[600],
    lineHeight: 20,
  },
});
