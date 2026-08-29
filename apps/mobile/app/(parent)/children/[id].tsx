import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type {
  ParentChildDetailResponse,
  ParentChildTodayResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import { unwrapEnvelope } from '../../../src/lib/errors';
import { useLoad } from '../../../src/hooks/useLoad';
import {
  BoardingBadge,
  Button,
  Card,
  ErrorState,
  KeyValue,
  LoadingView,
  Screen,
  SectionTitle,
  TripStatusBadge,
} from '../../../src/components';
import { formatTime, fullName } from '../../../src/lib/format';

/**
 * Child detail: profile, home stop, today's run with crew and bus, and the
 * boarding/drop state — from `/parent/children/:id` and `/today` (the
 * read-only parent projections of the existing backend).
 */
export default function ParentChildDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const childId = typeof id === 'string' ? id : '';

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    detail: ParentChildDetailResponse;
    today: ParentChildTodayResponse | null;
  }> => {
    const detail = unwrapEnvelope(await apiClient.getParentChild(childId));
    const today = await apiClient
      .getParentChildToday(childId)
      .then((envelope) => unwrapEnvelope(envelope))
      .catch(() => null);
    return { detail, today };
  }, [childId]);

  if (loading && !data) {
    return <LoadingView label="Loading child…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load this child'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const { detail: child, today } = data;
  const trip = child.today.trip;

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      <Card title={fullName(child)}>
        <View style={styles.badgeRow}>
          <BoardingBadge status={child.today.attendance?.status} />
          {!child.is_active ? <Text style={styles.inactive}>Inactive</Text> : null}
        </View>
        <View style={styles.kvRow}>
          <KeyValue label="Admission no." value={child.admission_number} />
          <KeyValue label="Grade" value={child.grade_level ?? '—'} />
          <KeyValue label="Relationship" value={child.relationship} />
        </View>
        {child.can_pick_up ? <Text style={styles.note}>Cleared to pick up</Text> : null}
      </Card>

      <Card title="Home stop">
        {child.home_stop.name ? (
          <>
            <Text style={styles.stopName}>{child.home_stop.name}</Text>
            {child.home_stop.address ? (
              <Text style={styles.muted}>{child.home_stop.address}</Text>
            ) : null}
            <Text style={styles.muted}>
              {child.home_stop.route_code
                ? `Route ${child.home_stop.route_code}${child.home_stop.route_name ? ` · ${child.home_stop.route_name}` : ''} · Stop ${child.home_stop.sequence_number ?? '—'}`
                : 'Route details unavailable'}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>No home stop assigned yet.</Text>
        )}
      </Card>

      <SectionTitle>Today&apos;s trip</SectionTitle>
      {trip ? (
        <Card title={child.home_stop.route_name ?? 'Bus trip'}>
          <View style={styles.badgeRow}>
            <TripStatusBadge status={trip.status} />
            <BoardingBadge status={child.today.attendance?.status} />
          </View>
          <View style={styles.kvRow}>
            <KeyValue label="Scheduled" value={formatTime(trip.scheduled_start_at)} />
            <KeyValue
              label="Bus"
              value={child.today.bus ? child.today.bus.registration_number : '—'}
            />
            <KeyValue
              label="Driver"
              value={
                today?.driver
                  ? fullName(today.driver)
                  : data.detail.driver
                    ? fullName(data.detail.driver)
                    : '—'
              }
            />
            <KeyValue
              label="Conductor"
              value={
                today?.conductor
                  ? fullName(today.conductor)
                  : data.detail.conductor
                    ? fullName(data.detail.conductor)
                    : '—'
              }
            />
          </View>
          {child.today.attendance?.boarded_at ? (
            <Text style={styles.muted}>
              Boarded at {formatTime(child.today.attendance.boarded_at)}
            </Text>
          ) : null}
          {child.today.attendance?.dropped_at ? (
            <Text style={styles.muted}>
              Dropped at {formatTime(child.today.attendance.dropped_at)}
            </Text>
          ) : null}
          <Button
            label="Track this bus"
            onPress={() => router.push({ pathname: '/tracking', params: { child: child.id } })}
            style={styles.trackButton}
          />
        </Card>
      ) : (
        <Text style={styles.muted}>No trip is scheduled for this child today.</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
    flexWrap: 'wrap',
  },
  inactive: {
    color: colors.neutral[500],
    fontSize: 12,
    fontWeight: '600',
  },
  kvRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  note: {
    color: colors.secondary[700],
    fontSize: 13,
    fontWeight: '600',
  },
  stopName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  muted: {
    color: colors.neutral[500],
    fontSize: 14,
    marginTop: 2,
  },
  trackButton: {
    marginTop: spacing.md,
    borderRadius: borderRadius.md,
  },
});
