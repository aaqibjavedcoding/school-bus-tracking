import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type {
  ParentChildDetailResponse,
  ParentChildTodayResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import { unwrapEnvelope } from '../../../src/lib/errors';
import { invalidIdMessage, isUuid } from '../../../src/lib/ids';
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
  // Never call the API without a real UUID: an empty `:id` resolves to the
  // children *list* endpoint, whose payload would crash this screen below.
  const usableId = isUuid(childId);

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    detail: ParentChildDetailResponse;
    today: ParentChildTodayResponse | null;
  }> => {
    if (!usableId) {
      throw new Error(invalidIdMessage('child'));
    }
    const detail = unwrapEnvelope(await apiClient.getParentChild(childId));
    const today = await apiClient
      .getParentChildToday(childId)
      .then((envelope) => unwrapEnvelope(envelope))
      .catch(() => null);
    return { detail, today };
  }, [childId, usableId]);

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
  // Defensive: `today`/`home_stop` are optional in practice (rest days, older
  // API builds) — read them with fallbacks instead of crashing the app.
  const childToday = child.today ?? { trip: null, attendance: null, bus: null };
  const trip = childToday.trip ?? null;
  const attendance = childToday.attendance ?? null;
  const homeStop = child.home_stop ?? {
    name: null,
    address: null,
    route_code: null,
    route_name: null,
    sequence_number: null,
  };

  return (
    <Screen refresh={() => void reload()} refreshing={loading}>
      {/* Detail routes hidden from the tab bar get no automatic back button
          (the group is a tab navigator, not a stack) — offer one explicitly. */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.backRow}
      >
        <Text style={styles.backText}>‹ Back</Text>
      </Pressable>

      <Card title={fullName(child)}>
        <View style={styles.badgeRow}>
          <BoardingBadge status={attendance?.status} />
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
        {homeStop.name ? (
          <>
            <Text style={styles.stopName}>{homeStop.name}</Text>
            {homeStop.address ? <Text style={styles.muted}>{homeStop.address}</Text> : null}
            <Text style={styles.muted}>
              {homeStop.route_code
                ? `Route ${homeStop.route_code}${homeStop.route_name ? ` · ${homeStop.route_name}` : ''} · Stop ${homeStop.sequence_number ?? '—'}`
                : 'Route details unavailable'}
            </Text>
          </>
        ) : (
          <Text style={styles.muted}>No home stop assigned yet.</Text>
        )}
      </Card>

      <SectionTitle>Today&apos;s trip</SectionTitle>
      {trip ? (
        <Card title={homeStop.route_name ?? 'Bus trip'}>
          <View style={styles.badgeRow}>
            <TripStatusBadge status={trip.status} />
            <BoardingBadge status={attendance?.status} />
          </View>
          <View style={styles.kvRow}>
            <KeyValue label="Scheduled" value={formatTime(trip.scheduled_start_at)} />
            <KeyValue
              label="Bus"
              value={childToday.bus ? childToday.bus.registration_number : '—'}
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
          {attendance?.boarded_at ? (
            <Text style={styles.muted}>Boarded at {formatTime(attendance.boarded_at)}</Text>
          ) : null}
          {attendance?.dropped_at ? (
            <Text style={styles.muted}>Dropped at {formatTime(attendance.dropped_at)}</Text>
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
  backRow: {
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    paddingVertical: 2,
  },
  backText: {
    color: colors.primary[700],
    fontSize: 15,
    fontWeight: '600',
  },
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
