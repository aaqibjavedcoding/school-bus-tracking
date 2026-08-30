import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  TripStatus,
  type RouteAssignmentListResponse,
  type RouteAssignmentResponse,
  type TripListResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import {
  fieldErrorsFromUnknown,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../src/lib/errors';
import { formatDate, formatTime, tripStatusLabel, utcDateOnly } from '../../src/lib/format';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Fab,
  Field,
  FormSheet,
  LoadingView,
  Screen,
  Select,
  TripStatusBadge,
  useToast,
} from '../../src/components';

/**
 * School-admin trip schedule — the mobile view of the web Trips page. Walk
 * the schedule day by day, filter by status, dispatch a new trip from an
 * active assignment, open the full cockpit or delete a trip.
 */

type StatusFilter = TripStatus | 'ALL';

const STATUS_FILTERS: StatusFilter[] = [
  'ALL',
  TripStatus.SCHEDULED,
  TripStatus.BOARDING,
  TripStatus.IN_PROGRESS,
  TripStatus.COMPLETED,
  TripStatus.CANCELLED,
];

function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function dayLabel(day: string): string {
  return formatDate(new Date(`${day}T12:00:00.000Z`));
}

/** `YYYY-MM-DDTHH:mm` in the device's local time for the datetime field. */
function localDateTimeValue(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function AdminTripsScreen() {
  const router = useRouter();
  const toast = useToast();
  const today = utcDateOnly();
  const [day, setDay] = useState(today);
  const [status, setStatus] = useState<StatusFilter>('ALL');

  const [open, setOpen] = useState(false);
  const [assignmentId, setAssignmentId] = useState('');
  const [startAt, setStartAt] = useState(localDateTimeValue());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TripResponse | null>(null);

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    trips: TripResponse[];
    assignments: RouteAssignmentResponse[];
  }> => {
    const [tripsEnvelope, assignmentsEnvelope] = await Promise.all([
      apiClient.listTrips({
        page: 1,
        limit: 50,
        date: day,
        status: status === 'ALL' ? undefined : status,
      }),
      apiClient.listAssignments({ page: 1, limit: 100, is_active: true }),
    ]);
    return {
      trips: unwrapEnvelope<TripListResponse>(tripsEnvelope).items,
      assignments: unwrapEnvelope<RouteAssignmentListResponse>(assignmentsEnvelope).items,
    };
  }, [day, status]);

  const isToday = day === today;

  const summary = useMemo(() => {
    const byStatus = new Map<TripStatus, number>();
    for (const trip of data?.trips ?? []) {
      byStatus.set(trip.status, (byStatus.get(trip.status) ?? 0) + 1);
    }
    return byStatus;
  }, [data]);

  const startCreate = () => {
    setAssignmentId('');
    setStartAt(localDateTimeValue());
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    if (!assignmentId) {
      setFieldErrors({ route_assignment_id: 'Select an assignment.' });
      return;
    }
    setBusy(true);
    setFieldErrors({});
    try {
      const trip = unwrapEnvelope(
        await apiClient.createTrip({
          route_assignment_id: assignmentId,
          scheduled_start_at: new Date(startAt).toISOString(),
        }),
      );
      toast.push('Trip scheduled.', 'success');
      setOpen(false);
      await reload();
      router.push(`/trips/${trip.id}`);
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiClient.deleteTrip(pendingDelete.id);
      toast.push('Trip deleted.', 'success');
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <LoadingView label="Loading the schedule…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load trips'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const routeLabel = (trip: TripResponse): string =>
    trip.route_code ? `${trip.route_code} · ${trip.route_name ?? ''}`.trim() : trip.route_name ?? 'Route';
  const busLabel = (trip: TripResponse): string =>
    trip.registration_number ?? trip.bus_number ?? '—';

  const assignmentOptions = data.assignments.map((assignment) => ({
    value: assignment.id,
    label: `${assignment.route_code ?? 'Route'} · ${assignment.user_name ?? 'Crew'} · ${assignment.role === 'DRIVER' ? 'Driver' : 'Conductor'}${assignment.bus_registration_number ? ` · ${assignment.bus_registration_number}` : ''}`,
  }));

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void reload()} refreshing={loading}>
        <View style={styles.dayRow}>
          <Pressable
            onPress={() => setDay((current) => shiftDay(current, -1))}
            style={styles.dayButton}
            accessibilityLabel="Previous day"
          >
            <Text style={styles.dayButtonText}>‹</Text>
          </Pressable>
          <View style={styles.dayLabel}>
            <Text style={styles.dayLabelText}>{dayLabel(day)}</Text>
            {isToday ? <Badge label="Today" tone="info" /> : null}
          </View>
          <Pressable
            onPress={() => setDay((current) => shiftDay(current, 1))}
            style={styles.dayButton}
            accessibilityLabel="Next day"
          >
            <Text style={styles.dayButtonText}>›</Text>
          </Pressable>
        </View>

        {!isToday ? (
          <Pressable onPress={() => setDay(today)} style={styles.backToToday}>
            <Text style={styles.backToTodayText}>Back to today</Text>
          </Pressable>
        ) : null}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {STATUS_FILTERS.map((filter) => {
            const active = filter === status;
            const count =
              filter === 'ALL' ? data.trips.length : (summary.get(filter as TripStatus) ?? 0);
            return (
              <Pressable
                key={filter}
                onPress={() => setStatus(filter)}
                style={[styles.chip, active ? styles.chipActive : null]}
              >
                <Text style={[styles.chipText, active ? styles.chipTextActive : null]}>
                  {filter === 'ALL' ? 'All' : tripStatusLabel(filter as TripStatus)} · {count}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {data.trips.length === 0 ? (
          <EmptyState
            title="No trips for this day"
            description={
              status === 'ALL'
                ? 'Nothing is scheduled. Tap + to dispatch a trip from an active assignment.'
                : `No ${tripStatusLabel(status as TripStatus).toLowerCase()} trips on this day.`
            }
          />
        ) : (
          data.trips.map((trip) => (
            <Pressable
              key={trip.id}
              onPress={() => router.push(`/trips/${trip.id}`)}
              onLongPress={() => setPendingDelete(trip)}
              style={({ pressed }) => [styles.card, pressed ? styles.cardPressed : null]}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle} numberOfLines={1}>
                    {routeLabel(trip)}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {formatTime(trip.scheduled_start_at)} · Bus {busLabel(trip)}
                  </Text>
                  {trip.driver_name ? (
                    <Text style={styles.cardMeta} numberOfLines={1}>
                      Driver {trip.driver_name}
                      {trip.conductor_name ? ` · Conductor ${trip.conductor_name}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
              <View style={styles.badgeRow}>
                <TripStatusBadge status={trip.status} />
                {trip.status === TripStatus.BOARDING || trip.status === TripStatus.IN_PROGRESS ? (
                  <Badge label="● Live" tone="success" />
                ) : null}
              </View>
            </Pressable>
          ))
        )}
        <Text style={styles.hint}>Tip: long-press a trip to delete it.</Text>
      </Screen>

      <Fab onPress={startCreate} label="Schedule" />

      <FormSheet
        open={open}
        title="Schedule trip"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setOpen(false)}
              style={styles.flex}
            />
            <Button label="Schedule" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Select
          label="Assignment"
          value={assignmentId}
          onChange={setAssignmentId}
          options={assignmentOptions}
          placeholder="Select an active assignment"
          error={fieldErrors.route_assignment_id}
        />
        <Field
          label="Scheduled start"
          value={startAt}
          onChangeText={setStartAt}
          placeholder="YYYY-MM-DDTHH:mm"
          autoCapitalize="none"
          error={fieldErrors.scheduled_start_at}
          hint="Local time, e.g. 2026-08-30T07:30"
        />
        {assignmentOptions.length === 0 ? (
          <Text style={styles.warn}>
            No active assignments yet. Create one under Manage → Assignments first.
          </Text>
        ) : null}
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete trip?"
        message="Open trips are cancelled first, then removed from the active list."
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  dayButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    backgroundColor: colors.neutral[50],
  },
  dayButtonText: {
    fontSize: 26,
    color: colors.primary[700],
    fontWeight: '700',
    marginTop: -4,
  },
  dayLabel: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  dayLabelText: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  backToToday: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  backToTodayText: {
    color: colors.primary[700],
    fontSize: 13,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: borderRadius.full,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
  },
  chipActive: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
  },
  chipText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.neutral[600],
  },
  chipTextActive: {
    color: '#ffffff',
  },
  card: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  cardMeta: {
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
  hint: {
    textAlign: 'center',
    color: colors.neutral[400],
    fontSize: typography.fontSizes.xs,
    marginTop: spacing.sm,
  },
  warn: {
    color: colors.status.warning,
    fontSize: typography.fontSizes.xs,
    marginTop: spacing.xs,
  },
});
