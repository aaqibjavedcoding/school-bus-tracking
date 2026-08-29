import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { ListRow } from '../../../../src/components/ListRow';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { ErrorBanner, LoadingView } from '../../../../src/components/Feedback';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useLoad } from '../../../../src/hooks/use-load';
import {
  attendanceStatusLabelFor,
  formatDateTime,
  fullName,
  tripStatusTone,
  TRIP_STATUS_LABELS,
} from '../../../../src/utils/format';

/**
 * Child detail (Task 23 §G): the child, home stop, route, bus, crew, today's
 * trip + attendance times — assembled from `GET /parent/children/:id/today`
 * (which already proves the parent↔child link server-side; a foreign id gets
 * the API's generic 404).
 */
export default function ParentChildDetailScreen() {
  const { childId } = useLocalSearchParams<{ childId: string }>();
  const api = getGlobalSession().apiClient;

  const detail = useLoad(async () => {
    const [today, child] = await Promise.all([
      api.getParentChildToday(childId),
      api.getParentChild(childId).catch(() => null),
    ]);
    return { today: today.data ?? null, child: child?.data ?? null };
  }, [childId]);

  if (detail.loading && !detail.data) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Loading child…" />
      </Screen>
    );
  }
  if (detail.error && !detail.data) {
    return (
      <Screen>
        <ErrorBanner message={detail.error} onRetry={() => void detail.reload()} />
      </Screen>
    );
  }

  const todayResponse = detail.data?.today;
  const child = todayResponse?.child ?? detail.data?.child ?? null;
  const today = child?.today ?? null;
  const trip = today?.trip ?? null;
  const attendance = today?.attendance ?? null;
  const bus = today?.bus ?? null;

  return (
    <Screen>
      {detail.error ? (
        <ErrorBanner message={detail.error} onRetry={() => void detail.reload()} />
      ) : null}
      {child ? (
        <Card
          title={`${child.first_name} ${child.last_name}`}
          description={`${child.admission_number}${child.grade_level ? ` · Grade ${child.grade_level}` : ''} · ${child.relationship}`}
          right={
            <StatusBadge
              tone={child.is_active ? 'success' : 'danger'}
              label={child.is_active ? 'ACTIVE' : 'INACTIVE'}
            />
          }
        >
          <ListRow
            title="Home stop"
            subtitle={child.home_stop?.name ?? 'Not assigned'}
            meta={child.home_stop?.address ?? undefined}
          />
          <ListRow
            title="Route"
            subtitle={child.home_stop?.route_name ?? 'Assigned through the route roster'}
            meta={child.home_stop?.route_code ?? undefined}
          />
          <ListRow
            title="Pick-up authorisation"
            subtitle={
              child.can_pick_up ? 'Allowed to collect this child' : 'Not authorised for pick-up'
            }
          />
        </Card>
      ) : null}

      {todayResponse ? (
        <Card
          title="Today’s trip"
          right={
            trip ? (
              <StatusBadge
                tone={tripStatusTone(trip.status)}
                label={TRIP_STATUS_LABELS[trip.status]}
              />
            ) : (
              <StatusBadge tone="neutral" label="NO TRIP" />
            )
          }
        >
          {trip ? (
            <>
              <ListRow
                title="Scheduled departure"
                subtitle={formatDateTime(trip.scheduled_start_at)}
              />
              {bus ? (
                <ListRow
                  title="Bus"
                  subtitle={bus.bus_number ? `Bus ${bus.bus_number}` : bus.registration_number}
                  meta={bus.registration_number}
                />
              ) : (
                <Text style={styles.note}>No bus assigned to this trip yet.</Text>
              )}
              {todayResponse.driver ? (
                <ListRow
                  title="Driver"
                  subtitle={fullName(
                    todayResponse.driver.first_name,
                    todayResponse.driver.last_name,
                  )}
                />
              ) : null}
              {todayResponse.conductor ? (
                <ListRow
                  title="Conductor"
                  subtitle={fullName(
                    todayResponse.conductor.first_name,
                    todayResponse.conductor.last_name,
                  )}
                />
              ) : null}
            </>
          ) : (
            <Text style={styles.note}>
              No trip is scheduled for {child?.first_name ?? 'your child'} today.
            </Text>
          )}
        </Card>
      ) : null}

      <Card
        title="Attendance"
        description="Times are recorded by the crew on the bus and stamped by the server."
      >
        {attendance ? (
          <>
            <ListRow
              title="Status"
              right={
                <StatusBadge
                  tone="info"
                  label={attendanceStatusLabelFor(attendance.status)}
                  compact
                />
              }
            />
            <ListRow
              title="Boarded"
              subtitle={attendance.boarded_at ? formatDateTime(attendance.boarded_at) : 'Not yet'}
            />
            <ListRow
              title="Dropped off"
              subtitle={attendance.dropped_at ? formatDateTime(attendance.dropped_at) : 'Not yet'}
            />
          </>
        ) : (
          <Text style={styles.note}>
            {trip
              ? 'No attendance recorded yet for today’s trip.'
              : 'Attendance appears once a trip runs.'}
          </Text>
        )}
      </Card>

      {todayResponse?.stops ? (
        <Card title="Route stops" description="Order as published by the school.">
          {todayResponse.stops.map((stop) => (
            <ListRow
              key={stop.id}
              title={`${stop.sequence_number}. ${stop.name}`}
              subtitle={stop.address ?? undefined}
              meta={stop.estimated_arrival_time ? `ETA ${stop.estimated_arrival_time}` : undefined}
              right={
                child?.home_stop?.id === stop.id ? (
                  <StatusBadge tone="success" label="HOME" compact />
                ) : undefined
              }
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: {
    fontSize: 13,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
});
