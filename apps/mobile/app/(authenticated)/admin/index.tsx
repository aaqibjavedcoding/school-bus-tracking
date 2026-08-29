import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { ListRow } from '../../../src/components/ListRow';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { ConnectionBanner } from '../../../src/components/ConnectionBanner';
import { ErrorBanner, SkeletonList } from '../../../src/components/Feedback';
import { SectionTitle, StatGrid } from '../../../src/components/StatCard';
import { useAuth } from '../../../src/auth/auth-context';
import { useAdminDashboard } from '../../../src/features/admin/admin-hooks';

/**
 * Admin dashboard (Task 23 §C): today's operational picture + mobile-friendly
 * entry points to the management areas. Counts come from the same list
 * endpoints the web console uses (meta.total), not a mobile-only aggregate.
 */
export default function AdminDashboard() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const dashboard = useAdminDashboard();

  return (
    <Screen>
      <ConnectionBanner />
      <Card
        title={user ? `Welcome, ${user.first_name}` : 'Welcome'}
        description="Mobile covers the operations that matter on the go. The web console keeps the full administration surface."
        right={<StatusBadge tone="info" label="SCHOOL ADMIN" compact />}
      >
        <View style={styles.headerActions}>
          <Text style={styles.schoolHint}>Tenant: derived from your session</Text>
          <Text style={styles.signOut} onPress={() => void logout()}>
            Sign out
          </Text>
        </View>
      </Card>

      {dashboard.error ? (
        <ErrorBanner message={dashboard.error} onRetry={() => void dashboard.refresh()} />
      ) : null}

      {dashboard.loading && !dashboard.data ? (
        <SkeletonList rows={2} />
      ) : (
        <>
          <SectionTitle title={`Today · ${dashboard.data?.today ?? ''}`} />
          <StatGrid
            items={[
              { label: 'Students', value: dashboard.data?.totalStudents ?? 0 },
              { label: 'Buses', value: dashboard.data?.totalBuses ?? 0 },
              { label: 'Drivers', value: dashboard.data?.totalDrivers ?? 0 },
              { label: 'Conductors', value: dashboard.data?.totalConductors ?? 0 },
              { label: 'Trips today', value: dashboard.data?.tripsToday ?? 0 },
              { label: 'Active', value: dashboard.data?.activeToday ?? 0 },
              { label: 'Completed', value: dashboard.data?.completedToday ?? 0 },
              { label: 'Cancelled', value: dashboard.data?.cancelledToday ?? 0 },
            ]}
          />
        </>
      )}

      <SectionTitle title="Manage" />
      <ListRow
        title="Students"
        subtitle="Roster, home stops, guardians"
        onPress={() => router.push('/admin/students' as never)}
      />
      <ListRow
        title="Parents"
        subtitle="Guardian accounts & links"
        onPress={() => router.push('/admin/parents' as never)}
      />
      <ListRow
        title="Drivers"
        subtitle="Crew accounts"
        onPress={() => router.push('/admin/drivers' as never)}
      />
      <ListRow
        title="Conductors"
        subtitle="Crew accounts"
        onPress={() => router.push('/admin/conductors' as never)}
      />
      <ListRow
        title="Buses"
        subtitle="Fleet"
        onPress={() => router.push('/admin/buses' as never)}
      />
      <ListRow
        title="Routes & stops"
        subtitle="Route plans, stop order"
        onPress={() => router.push('/admin/routes' as never)}
      />
      <ListRow
        title="Assignments"
        subtitle="Route ↔ bus ↔ crew rosters"
        onPress={() => router.push('/admin/assignments' as never)}
      />
      <ListRow
        title="Trips"
        subtitle="Schedule, status, manifests"
        onPress={() => router.push('/admin/trips' as never)}
      />
      <ListRow
        title="Live monitoring"
        subtitle="Active trips, positions, ETAs"
        right={<StatusBadge tone="success" label="LIVE" compact />}
        onPress={() => router.push('/admin/monitoring' as never)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  schoolHint: {
    fontSize: 12,
    color: colors.neutral[500],
  },
  signOut: {
    color: colors.primary[700],
    fontWeight: '700',
    fontSize: 13,
  },
  chevron: {
    fontSize: 18,
    color: colors.neutral[400],
  },
});
