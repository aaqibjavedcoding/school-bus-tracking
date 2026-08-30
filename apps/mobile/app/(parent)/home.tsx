import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { ParentDashboardResponse } from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { unwrapEnvelope } from '../../src/lib/errors';
import { useLoad } from '../../src/hooks/useLoad';
import {
  BoardingBadge,
  Button,
  EmptyState,
  ErrorState,
  LoadingView,
  Screen,
  SearchBar,
  SectionTitle,
  TripStatusBadge,
} from '../../src/components';
import { fullName } from '../../src/lib/format';

/**
 * Parent dashboard: today at a glance for every linked child — trip status,
 * boarding/drop state and the home stop, straight from the read-only
 * `/parent/dashboard` projection. Tapping a child opens their detail.
 */
export default function ParentHomeScreen() {
  const router = useRouter();
  const { data, loading, error, reload } = useLoad<ParentDashboardResponse>(async () => {
    return unwrapEnvelope(await apiClient.getParentDashboard());
  }, []);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();

  const visibleChildren = useMemo(() => {
    const children = data?.children ?? [];
    if (!term) return children;
    return children.filter((child) =>
      [
        fullName(child),
        child.admission_number,
        child.grade_level,
        child.home_stop?.name,
        child.home_stop?.route_code,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(term)),
    );
  }, [data, term]);

  if (loading && !data) {
    return <LoadingView label="Loading your children…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState
          message={error ?? 'Could not load the dashboard'}
          onRetry={() => void reload()}
        />
      </Screen>
    );
  }

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <SectionTitle>{data.school ? data.school.name : 'Your school'}</SectionTitle>
      <Text style={styles.greeting}>
        Hi {data.parent.first_name} — {data.count === 1 ? 'one child' : `${data.count} children`} to
        follow today.
      </Text>

      {data.children.length > 2 ? (
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
          placeholder="Search your children…"
        />
      ) : null}

      {data.children.length === 0 ? (
        <EmptyState
          title="No children linked yet"
          description="No children are linked to your account yet. Please contact your school."
        />
      ) : visibleChildren.length === 0 ? (
        <EmptyState
          title="No matching children"
          description={`Nothing matched “${search.trim()}”.`}
          action={
            <Button label="Clear search" variant="secondary" onPress={() => setSearch('')} />
          }
        />
      ) : (
        visibleChildren.map((child) => {
          const trip = child.today?.trip ?? null;
          return (
            <Pressable
              key={child.id}
              onPress={() => router.push(`/children/${child.id}`)}
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.childName}>{fullName(child)}</Text>
                  <Text style={styles.childMeta}>
                    {child.admission_number}
                    {child.grade_level ? ` · ${child.grade_level}` : ''} · {child.relationship}
                  </Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>

              <View style={styles.badgeRow}>
                {trip ? (
                  <TripStatusBadge status={trip.status} />
                ) : (
                  <Text style={styles.noTrip}>No trip today</Text>
                )}
                <BoardingBadge status={child.today?.attendance?.status} />
              </View>

              <Text style={styles.stopLine} numberOfLines={1}>
                {child.home_stop?.name
                  ? `Stop: ${child.home_stop.name}${child.home_stop.route_code ? ` · Route ${child.home_stop.route_code}` : ''}`
                  : 'No home stop assigned'}
              </Text>
            </Pressable>
          );
        })
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  greeting: {
    color: colors.neutral[600],
    marginBottom: spacing.md,
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  childName: {
    fontSize: typography.fontSizes.lg,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  childMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  chevron: {
    fontSize: 22,
    color: colors.neutral[300],
    fontWeight: '700',
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  noTrip: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.xs,
    fontWeight: '600',
  },
  stopLine: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
  },
});
