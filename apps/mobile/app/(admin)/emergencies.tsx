import React, { useCallback, useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  EMERGENCY_EVENTS,
  EMERGENCY_STATUS_LABELS,
  EMERGENCY_TYPE_LABELS,
  EmergencyStatus,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';
import { colors, spacing, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../src/services/api';
import { getEmergenciesSocket } from '../../src/services/emergencies-socket';
import { connectAuthenticatedSocket } from '../../src/services/socket-auth';
import { getApiErrorMessage, unwrapEnvelope } from '../../src/lib/errors';
import {
  emergencyActionLabel,
  emergencyStatusTone,
  nextEmergencyActions,
} from '../../src/features/admin/emergencies/helpers';
import { formatDateTime, formatRelative } from '../../src/lib/format';
import { buildNavigationUrl } from '../../src/lib/navigation';
import { useLoad } from '../../src/hooks/useLoad';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  FormSheet,
  ListScreen,
  LoadingView,
  SegmentedControl,
  useToast,
} from '../../src/components';

/**
 * School-admin emergency console (Task 44) — the other end of the crew SOS.
 *
 * Crew raise an alert from their phone; it is recorded server-side and pushed
 * into this tenant's Socket.IO room, so this screen updates on its own. The
 * admin acknowledges to show they are handling it, and resolves (or cancels a
 * false alarm) with an optional audit note.
 *
 * Delivery is entirely first-party — database + the self-hosted Socket.IO
 * gateway. No SMS, WhatsApp, push vendor or any other paid service is used.
 */

type StatusFilter = 'active' | 'all' | EmergencyStatus.RESOLVED | EmergencyStatus.CANCELLED;

const FILTER_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'all', label: 'All' },
  { value: EmergencyStatus.RESOLVED, label: 'Resolved' },
  { value: EmergencyStatus.CANCELLED, label: 'Cancelled' },
];

export default function AdminEmergenciesScreen() {
  const toast = useToast();
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    event: EmergencyEventResponse;
    status: EmergencyStatus;
  } | null>(null);

  const load = useCallback(async () => {
    if (filter === 'active') {
      const data = unwrapEnvelope(await apiClient.listActiveEmergencies());
      return data.items;
    }
    const data = unwrapEnvelope(
      await apiClient.listEmergencies({
        limit: 50,
        status: filter === 'all' ? undefined : filter,
      }),
    );
    return data.items;
  }, [filter]);

  const { data, loading, error, reload } = useLoad<EmergencyEventResponse[]>(load, [load]);

  // Live feed: the gateway puts this socket in the school's room from the
  // verified JWT, so a new SOS or a status change arrives without polling.
  useEffect(() => {
    const socket = getEmergenciesSocket();
    const refresh = () => void reload();
    connectAuthenticatedSocket(socket);
    socket.on(EMERGENCY_EVENTS.new, refresh);
    socket.on(EMERGENCY_EVENTS.updated, refresh);
    return () => {
      socket.off(EMERGENCY_EVENTS.new, refresh);
      socket.off(EMERGENCY_EVENTS.updated, refresh);
    };
  }, [reload]);

  const apply = async () => {
    if (!pending) return;
    setBusyId(pending.event.id);
    try {
      unwrapEnvelope(
        await apiClient.updateEmergencyStatus(pending.event.id, {
          status: pending.status,
          note: note.trim() || null,
        }),
      );
      toast.push(`Alert ${EMERGENCY_STATUS_LABELS[pending.status].toLowerCase()}.`, 'success');
      setPending(null);
      setNote('');
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusyId(null);
    }
  };

  const events = data ?? [];
  const openCount = events.filter((event) => event.status === EmergencyStatus.OPEN).length;

  return (
    <>
      <ListScreen
        data={events}
        keyExtractor={(event) => event.id}
        renderItem={({ item: event }) => (
          <Card
            title={`${EMERGENCY_TYPE_LABELS[event.type]} · ${event.raised_by_name ?? 'Crew'}`}
            description={
              event.raised_by_role ? `Raised by ${event.raised_by_role.toLowerCase()}` : undefined
            }
          >
            <View style={styles.metaRow}>
              <Badge
                label={EMERGENCY_STATUS_LABELS[event.status]}
                tone={emergencyStatusTone(event.status)}
              />
              <Text style={styles.meta}>{formatRelative(event.triggered_at)}</Text>
            </View>

            <Text style={styles.line}>
              {[event.bus_registration_number, event.route_name].filter(Boolean).join(' · ') ||
                'No bus attached'}
            </Text>
            {event.message ? <Text style={styles.message}>“{event.message}”</Text> : null}
            <Text style={styles.meta}>{formatDateTime(event.triggered_at)}</Text>
            {event.acknowledged_at ? (
              <Text style={styles.meta}>
                Acknowledged {formatRelative(event.acknowledged_at)}
                {event.acknowledged_by_name ? ` by ${event.acknowledged_by_name}` : ''}
              </Text>
            ) : null}
            {event.resolved_at ? (
              <Text style={styles.meta}>
                Closed {formatRelative(event.resolved_at)}
                {event.resolved_by_name ? ` by ${event.resolved_by_name}` : ''}
                {event.resolution_note ? ` · “${event.resolution_note}”` : ''}
              </Text>
            ) : null}

            {event.latitude !== null && event.longitude !== null ? (
              <OpenInMaps
                latitude={event.latitude}
                longitude={event.longitude}
                label="Open the reported location"
              />
            ) : (
              <Text style={styles.meta}>No location was shared with this alert.</Text>
            )}

            {nextEmergencyActions(event.status).length > 0 ? (
              <View style={styles.actions}>
                {nextEmergencyActions(event.status).map((status) => (
                  <Button
                    key={status}
                    label={emergencyActionLabel(status)}
                    variant={status === EmergencyStatus.ACKNOWLEDGED ? 'primary' : 'secondary'}
                    small
                    busy={busyId === event.id}
                    onPress={() => setPending({ event, status })}
                    style={styles.action}
                  />
                ))}
              </View>
            ) : null}
          </Card>
        )}
        header={
          <>
            <SegmentedControl<StatusFilter>
              value={filter}
              onChange={setFilter}
              options={FILTER_OPTIONS}
            />
            {openCount > 0 ? (
              <Card title="Unacknowledged now" description="Crew are waiting for a response.">
                <View style={styles.alertRow}>
                  <Ionicons name="alert-circle" size={20} color={colors.status.danger} />
                  <Text style={styles.alertText}>
                    {openCount} alert{openCount === 1 ? '' : 's'} not yet acknowledged.
                  </Text>
                </View>
              </Card>
            ) : null}
          </>
        }
        empty={
          loading && !data ? (
            <LoadingView label="Loading emergencies…" />
          ) : error ? (
            <ErrorState message={error} onRetry={() => void reload()} />
          ) : (
            <EmptyState
              title={filter === 'active' ? 'No active emergencies' : 'Nothing here'}
              description={
                filter === 'active'
                  ? 'When a driver or conductor raises an SOS it appears here immediately.'
                  : 'No emergency matches this filter.'
              }
            />
          )
        }
        refresh={() => void reload()}
        refreshing={loading}
      />

      {/**
       * Status changes go through a sheet rather than a bare confirm dialog:
       * the school may want to record what happened, and that note is stored
       * with the transition as an audit trail.
       */}
      <FormSheet
        open={Boolean(pending)}
        title={pending ? `${emergencyActionLabel(pending.status)} alert` : ''}
        onClose={() => {
          setPending(null);
          setNote('');
        }}
        footer={
          <>
            <Button
              label="Back"
              variant="secondary"
              onPress={() => {
                setPending(null);
                setNote('');
              }}
            />
            <Button
              label={pending ? emergencyActionLabel(pending.status) : 'Confirm'}
              variant={pending?.status === EmergencyStatus.CANCELLED ? 'danger' : 'primary'}
              onPress={() => void apply()}
              busy={busyId !== null}
            />
          </>
        }
      >
        <Text style={styles.meta}>
          {pending
            ? pending.status === EmergencyStatus.CANCELLED
              ? 'Cancel only if the alert was raised by mistake. The record stays in the school history.'
              : 'The crew member sees the new status immediately.'
            : ''}
        </Text>
        <Field
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="What happened / what was done"
          multiline
        />
      </FormSheet>
    </>
  );
}

/**
 * Map hand-off for the coordinates the crew device actually reported.
 *
 * `buildNavigationUrl` returns `null` for anything out of range, and the
 * button is simply not rendered in that case rather than opening a URL built
 * from a value we do not trust.
 */
const OpenInMaps: React.FC<{ latitude: number; longitude: number; label: string }> = ({
  latitude,
  longitude,
  label,
}) => {
  const url = buildNavigationUrl({ name: 'Emergency location', latitude, longitude });
  if (!url) {
    return <Text style={styles.meta}>The reported location cannot be shown on a map.</Text>;
  }
  return (
    <Button
      label={label}
      variant="secondary"
      small
      onPress={() => void Linking.openURL(url)}
      style={styles.action}
    />
  );
};

const styles = StyleSheet.create({
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  alertText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  meta: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: 2,
  },
  line: {
    fontSize: typography.fontSizes.base,
    color: colors.neutral[700],
    marginTop: spacing.xs,
  },
  message: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[800],
    fontStyle: 'italic',
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  action: { marginTop: spacing.sm, marginRight: spacing.sm },
});
