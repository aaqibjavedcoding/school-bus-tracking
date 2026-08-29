import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { TripStatus } from '@school-bus-tracking/shared-types';
import { tripCancelSchema } from '@school-bus-tracking/validation';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { Button } from '../../../../src/components/Button';
import { TextField } from '../../../../src/components/TextField';
import { ListRow } from '../../../../src/components/ListRow';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { EmptyState, ErrorBanner, LoadingView } from '../../../../src/components/Feedback';
import { TripStatusControls } from '../../../../src/features/crew/TripStatusControls';
import { ManifestPanel } from '../../../../src/features/crew/ManifestPanel';
import { useToast } from '../../../../src/components/Toast';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useTripWorkspace } from '../../../../src/features/crew/use-trip-workspace';
import { messageFromError, zodFieldErrors } from '../../../../src/features/admin/admin-shared';
import { formatDateTime, tripStatusTone, TRIP_STATUS_LABELS } from '../../../../src/utils/format';

/**
 * Admin trip operations (Task 23 §C): move the lifecycle through the same
 * endpoint + transition table the crew app uses, cancel with a reason, audit
 * the manifest read-only, and jump into live monitoring. Everything on screen
 * is server state; the API stays authoritative about who may do what.
 */
export default function AdminTripDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const toast = useToast();
  const workspace = useTripWorkspace(id, { canOperate: true });

  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const {
    trip,
    route,
    bus,
    manifest,
    progress,
    loading,
    error,
    refresh,
    live,
    allowedNextStatuses,
    setStatus,
  } = workspace;

  useEffect(() => {
    if (workspace.lastActionMessage) {
      toast.show(workspace.lastActionMessage, 'danger');
      workspace.clearLastActionMessage();
    }
  }, [workspace.lastActionMessage, workspace.clearLastActionMessage, toast]);

  if (loading && !trip) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Loading trip…" />
      </Screen>
    );
  }
  if (!trip) {
    return (
      <Screen scroll={false}>
        <EmptyState title="Trip not found" message="It may have been deleted." icon="🚍" />
      </Screen>
    );
  }

  const handleTransition = async (
    next: TripStatus,
    cancellationReason?: string | null,
  ): Promise<boolean> => {
    const ok = await setStatus(next, cancellationReason ?? null);
    if (ok) {
      toast.show(`${TRIP_STATUS_LABELS[next]} — confirmed by the server.`, 'success');
    }
    return ok;
  };

  const cancelTrip = async (): Promise<void> => {
    setCancelError(null);
    const parsed = tripCancelSchema.safeParse({
      cancellation_reason: reason.trim() ? reason.trim() : null,
    });
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error);
      setCancelError(fieldErrors.cancellation_reason ?? 'Check the cancellation reason.');
      return;
    }
    setCancelBusy(true);
    try {
      await api.cancelTrip(id, { cancellation_reason: parsed.data.cancellation_reason ?? null });
      toast.show('Trip cancelled — guardians are notified by the API queue.', 'success');
      setCancelling(false);
      setReason('');
      void refresh();
    } catch (caught) {
      setCancelError(messageFromError(caught, 'Could not cancel the trip.'));
    } finally {
      setCancelBusy(false);
    }
  };

  const cancellable = trip.status === TripStatus.SCHEDULED || trip.status === TripStatus.BOARDING;
  const showCancelForm = cancelling && cancellable;

  return (
    <Screen>
      {error ? <ErrorBanner message={error} onRetry={() => void refresh()} /> : null}

      <Card
        title={route?.name ?? 'Route'}
        description={`${formatDateTime(trip.scheduled_start_at)}${trip.scheduled_end_at ? ` → ${formatDateTime(trip.scheduled_end_at)}` : ''}`}
        right={
          <StatusBadge tone={tripStatusTone(trip.status)} label={TRIP_STATUS_LABELS[trip.status]} />
        }
      >
        <ListRow
          title="Bus"
          subtitle={
            bus?.bus_number
              ? `Bus ${bus.bus_number}`
              : (bus?.registration_number ?? 'No bus on this trip')
          }
          meta={bus ? `Capacity ${bus.capacity}` : undefined}
        />
        <ListRow
          title="Departed / completed"
          subtitle={`${trip.actual_start_at ? formatDateTime(trip.actual_start_at) : '—'} → ${
            trip.actual_end_at ? formatDateTime(trip.actual_end_at) : '—'
          }`}
        />
        {trip.cancellation_reason ? (
          <Text style={styles.cancelledNote}>Cancelled: {trip.cancellation_reason}</Text>
        ) : null}
        <Text style={styles.attendance}>
          Manifest: {manifest?.summary.total ?? 0} students · {manifest?.summary.boarded ?? 0}{' '}
          boarded · {manifest?.summary.dropped ?? 0} dropped off
        </Text>
        <Text style={styles.liveLine}>
          {live.fix
            ? `Live position ${live.fix.recorded_at.slice(11, 19)} UTC`
            : live.noLocationYet
              ? 'Trip open — no GPS fix reported yet'
              : 'No live position'}
        </Text>
      </Card>

      <Card
        title="Lifecycle"
        description="Allowed transitions only (shared table); the API re-validates every move — including that admins may adjust a trip the crew already started."
      >
        <TripStatusControls
          status={trip.status}
          allowed={allowedNextStatuses}
          onTransition={handleTransition}
        />
        {cancellable && !showCancelForm ? (
          <Button
            label="Cancel this trip"
            variant="danger"
            onPress={() => {
              setCancelError(null);
              setCancelling(true);
            }}
            style={styles.cancelToggle}
          />
        ) : null}
        {showCancelForm ? (
          <View style={styles.cancelForm}>
            <TextField
              label="Reason (optional on this endpoint; required by your school policy?)"
              value={reason}
              error={cancelError}
              placeholder="Vehicle breakdown, weather…"
              onChangeText={setReason}
            />
            <View style={styles.cancelActions}>
              <Button label="Keep trip" variant="ghost" onPress={() => setCancelling(false)} />
              <Button
                label={cancelBusy ? 'Cancelling…' : 'Cancel trip'}
                variant="danger"
                busy={cancelBusy}
                onPress={() => void cancelTrip()}
              />
            </View>
          </View>
        ) : null}
      </Card>

      <Button
        label="Monitor live"
        variant="secondary"
        onPress={() => router.push(`/admin/monitoring/${trip.id}` as never)}
        disabled={
          trip.status === TripStatus.SCHEDULED ||
          trip.status === TripStatus.COMPLETED ||
          trip.status === TripStatus.CANCELLED
        }
        style={styles.monitor}
      />

      <Card
        title={`Manifest (${manifest?.items.length ?? 0})`}
        description="Read-only here — boardings and drop-offs are recorded by the crew on the bus."
      >
        <ManifestPanel
          manifest={manifest}
          tripStatus={trip.status}
          canRecord={false}
          busyStudentId={null}
          onAction={async () => undefined}
        />
      </Card>

      {progress ? (
        <Text style={styles.progressNote}>
          Tracking state: {progress.tracking_state.replace(/_/g, ' ').toLowerCase()} ·{' '}
          {progress.arrivals.length} stop arrival{progress.arrivals.length === 1 ? '' : 's'}{' '}
          recorded.
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  attendance: {
    fontSize: 13,
    color: colors.neutral[700],
    marginTop: spacing.xs,
  },
  liveLine: {
    fontSize: 12,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  cancelledNote: {
    fontSize: 13,
    color: colors.status.danger,
    fontWeight: '600',
    marginTop: spacing.xs,
  },
  cancelForm: {
    marginTop: spacing.md,
  },
  cancelActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  cancelToggle: {
    marginTop: spacing.md,
  },
  monitor: {
    marginBottom: spacing.md,
  },
  progressNote: {
    fontSize: 12,
    color: colors.neutral[600],
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
});
