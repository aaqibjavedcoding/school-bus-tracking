import React, { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import {
  EMERGENCY_EVENTS,
  EMERGENCY_STATUS_LABELS,
  EMERGENCY_TYPE_LABELS,
  EMERGENCY_TYPE_VALUES,
  EmergencyStatus,
  EmergencyType,
  type EmergencyEventResponse,
} from '@school-bus-tracking/shared-types';
import { emergencySosSchema } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../services/api';
import { getEmergenciesSocket } from '../../services/emergencies-socket';
import { getApiErrorMessage, unwrapEnvelope } from '../../lib/errors';
import { formatRelative } from '../../lib/format';
import { emergencyStatusTone, isEmergencyActive } from '../admin/emergencies/helpers';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  FormSheet,
  Select,
  SwitchRow,
  type SelectOption,
} from '../../components';

/**
 * Crew SOS (Task 44) — the emergency affordance of the crew app.
 *
 * One shared component serves the driver and the conductor: the role only
 * changes the wording, never the capability. Pressing SOS:
 *
 * 1. captures the device's real position (optional — an alert must always be
 *    possible, and a coordinate is never invented),
 * 2. posts `POST /emergencies/sos`, so the event is durable even if the socket
 *    is down,
 * 3. is broadcast by the backend to the school's Socket.IO room, so the admin
 *    console and the web cockpit see it immediately.
 *
 * Delivery is entirely self-hosted — no SMS gateway, WhatsApp or push vendor
 * is involved anywhere in the flow.
 */

export interface SosPanelProps {
  /** Trip the alert is attached to; `null` for an off-duty emergency. */
  tripId: string | null;
  /** Role-specific wording ("driver" / "conductor"). */
  roleLabel: string;
}

export const SosPanel: React.FC<SosPanelProps> = ({ tripId, roleLabel }) => {
  const [history, setHistory] = useState<EmergencyEventResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(false);
  const [type, setType] = useState<EmergencyType>(EmergencyType.ACCIDENT);
  const [message, setMessage] = useState('');
  const [shareLocation, setShareLocation] = useState(true);
  const [pendingCancel, setPendingCancel] = useState<EmergencyEventResponse | null>(null);

  const reload = useCallback(async () => {
    try {
      const list = unwrapEnvelope(await apiClient.listMyEmergencies({ limit: 5 }));
      setHistory(list.items);
    } catch {
      // A failed history load must never block raising an alert.
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Live: the school acknowledging or resolving an alert updates this panel
  // without a refresh (the gateway joins this socket to the tenant room).
  useEffect(() => {
    const socket = getEmergenciesSocket();
    const refresh = () => void reload();
    socket.connect();
    socket.on(EMERGENCY_EVENTS.updated, refresh);
    socket.on(EMERGENCY_EVENTS.new, refresh);
    return () => {
      socket.off(EMERGENCY_EVENTS.updated, refresh);
      socket.off(EMERGENCY_EVENTS.new, refresh);
    };
  }, [reload]);

  const raise = async () => {
    setBusy(true);
    try {
      const coordinates = shareLocation ? await readPosition() : {};
      const parsed = emergencySosSchema.safeParse({
        trip_id: tripId,
        type,
        message: message.trim() || null,
        ...coordinates,
      });
      if (!parsed.success) {
        Alert.alert('Could not send SOS', parsed.error.issues[0]?.message ?? 'Invalid alert');
        return;
      }
      unwrapEnvelope(await apiClient.raiseSos(parsed.data));
      Alert.alert('SOS sent', 'The school has been alerted and can see your trip.');
      setComposing(false);
      setMessage('');
      await reload();
    } catch (caught) {
      Alert.alert('Could not send SOS', getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!pendingCancel) return;
    setBusy(true);
    try {
      unwrapEnvelope(await apiClient.cancelMyEmergency(pendingCancel.id));
      setPendingCancel(null);
      await reload();
    } catch (caught) {
      Alert.alert('Could not cancel the alert', getApiErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const active = history.find((event) => isEmergencyActive(event.status));

  const typeOptions: SelectOption[] = EMERGENCY_TYPE_VALUES.map((value) => ({
    value,
    label: EMERGENCY_TYPE_LABELS[value],
  }));

  return (
    <View>
      {active ? (
        <Card title="Alert active">
          <View style={styles.activeRow}>
            <Ionicons name="alert-circle" size={20} color={colors.status.danger} />
            <Text style={styles.activeText}>
              {EMERGENCY_TYPE_LABELS[active.type]} · {EMERGENCY_STATUS_LABELS[active.status]} ·{' '}
              {formatRelative(active.triggered_at)}
            </Text>
          </View>
          <Text style={styles.muted}>
            {active.acknowledged_at
              ? 'The school acknowledged this alert. Help is on the way.'
              : 'The school has been notified. Keep your phone with you.'}
          </Text>
          <Button
            label="Cancel alert"
            variant="secondary"
            onPress={() => setPendingCancel(active)}
            busy={busy}
            style={styles.action}
          />
        </Card>
      ) : null}

      <Card
        title="Emergency SOS"
        description={`Alerts the school office instantly${
          tripId ? ' and attaches your current trip' : ''
        }.`}
      >
        <Text style={styles.muted}>
          Use it for accidents, breakdowns, medical incidents or anything that puts students at
          risk. The alert is recorded against your {roleLabel} account with the school's own clock.
        </Text>
        <Button
          label="Send SOS"
          onPress={() => setComposing(true)}
          busy={busy}
          style={styles.action}
        />
      </Card>

      {history.length > 0 ? (
        <Card title="Your recent alerts">
          {history.map((event) => (
            <View key={event.id} style={styles.historyRow}>
              <Ionicons
                name={event.status === EmergencyStatus.RESOLVED ? 'checkmark-circle' : 'time'}
                size={16}
                color={
                  event.status === EmergencyStatus.RESOLVED
                    ? colors.secondary[600]
                    : colors.neutral[400]
                }
              />
              <Text style={styles.historyText}>
                {EMERGENCY_TYPE_LABELS[event.type]} · {formatRelative(event.triggered_at)}
              </Text>
              <Badge
                label={EMERGENCY_STATUS_LABELS[event.status]}
                tone={emergencyStatusTone(event.status)}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <FormSheet
        open={composing}
        title="Report an emergency"
        onClose={() => setComposing(false)}
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setComposing(false)}
              style={styles.flex}
            />
            <Button label="Send SOS" onPress={() => void raise()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Select
          label="What is happening?"
          value={type}
          options={typeOptions}
          onChange={(value) => setType(value as EmergencyType)}
        />
        <Field
          label="Message"
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder="e.g. Bus hit a divider, all students safe."
        />
        <SwitchRow
          label="Attach my location"
          hint="Used only if the device already has a GPS fix — a position is never invented."
          value={shareLocation}
          onChange={setShareLocation}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        title="Cancel this alert?"
        message="Only cancel if the alert was raised by mistake — the school still keeps the record in its history."
        confirmLabel="Cancel alert"
        danger
        busy={busy}
        onCancel={() => setPendingCancel(null)}
        onConfirm={() => void cancel()}
      />
    </View>
  );
};

/**
 * Best-effort device position.
 *
 * Resolves to `{}` when permission is denied or the fix times out: an SOS must
 * never be blocked by a missing fix, and a fallback coordinate is never
 * invented — the backend stores `null` and reports it as such.
 */
async function readPosition(): Promise<{
  latitude?: number;
  longitude?: number;
  accuracy?: number | null;
}> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    const granted =
      permission.status === 'granted' ||
      (permission.status === 'undetermined' &&
        (await Location.requestForegroundPermissionsAsync()).status === 'granted');
    if (!granted) {
      return {};
    }
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy ?? null,
    };
  } catch {
    return {};
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  muted: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[500],
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
    borderRadius: borderRadius.md,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  historyText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[700],
  },
});
