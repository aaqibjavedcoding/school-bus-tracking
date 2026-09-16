import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
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
import { colors, spacing, borderRadius } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../services/api';
import { getEmergenciesSocket } from '../../services/emergencies-socket';
import { connectAuthenticatedSocket } from '../../services/socket-auth';
import { getLocalizedApiError, unwrapEnvelope } from '../../lib/errors';
import { formatRelative, formatTime } from '../../lib/format';
import { withIdempotencyKey } from '@school-bus-tracking/api-client';
import { shouldQueueAfterError } from './offline/useOfflineAction';
import { emergencyStatusTone, isEmergencyActive } from '../admin/emergencies/helpers';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
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
import { HoldToConfirmButton } from './HoldToConfirmButton';
import { SosSession, type SosDeliveryStatus } from './sos-flow';
import { crewCopy } from './crew-copy';
import { t } from '../../lib/i18n.ts';
import { useTranslation } from '../../lib/i18n-provider';
import { feedback } from './crew-feedback.ts';

/**
 * Crew SOS (Task 44 + Phase 2) — the emergency affordance of the crew app.
 *
 * One shared component serves the driver and the conductor: the role only
 * changes the wording, never the capability. Phase 2 changes *how it is
 * raised*, nothing else:
 *
 * 1. **Hold-to-confirm** (~0.9s, `HoldToConfirmButton`) replaces the plain
 *    press — a brush can fire an SOS, a hold cannot. The alert sends with
 *    sensible defaults (type "accident", location attached); the detail
 *    sheet (type/message/location) stays available for when there *is*
 *    time — and even its confirm button is a hold.
 * 2. **One key per alert** (`SosSession`): every retry of the same alert
 *    reuses the same idempotency key, so a double-press, a flaky network or
 *    the client's own 401-refresh replay can never record a second SOS.
 *    The contract of `POST /api/v1/emergencies/sos` is untouched.
 * 3. **Offline is honest**: a network-level failure queues the attempt —
 *    the UI shows "queued ⏳" and retries by itself when connectivity
 *    returns (same key). Queueability is decided by the attendance queue's
 *    own shared rule (`shouldQueueAfterError`). Session-scoped by design:
 *    the durable offline queue is attendance-only (Phase-2 zero-touch).
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

/**
 * Server error text for an SOS alert: a known code becomes the app's own copy,
 * an unknown one is shown as the server sent it with its raw code appended.
 */
function localizedErrorText(caught: unknown): string {
  const localized = getLocalizedApiError(caught);
  return localized.codeNote ? `${localized.message} (${localized.codeNote})` : localized.message;
}

/** Details captured with (or after) the hold — defaults need zero reading. */
export interface SosDetails {
  type: EmergencyType;
  message: string;
  shareLocation: boolean;
}

const DEFAULT_DETAILS: SosDetails = {
  type: EmergencyType.ACCIDENT,
  message: '',
  shareLocation: true,
};

/**
 * The SOS state machine in React clothing: hold → send → sent ✅ / queued ⏳
 * (auto-retry with the same key) / failed. Shared by the SOS tab panel and
 * the trip screen's quick button so both paths behave identically.
 */
export function useCrewSos(tripId: string | null) {
  const sessionRef = useRef<SosSession | null>(null);
  if (sessionRef.current === null) {
    sessionRef.current = new SosSession();
  }
  const session = sessionRef.current;

  const [status, setStatus] = useState<SosDeliveryStatus>('idle');
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<EmergencyEventResponse[]>([]);
  const lastDetails = useRef<SosDetails>(DEFAULT_DETAILS);

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
    connectAuthenticatedSocket(socket);
    socket.on(EMERGENCY_EVENTS.updated, refresh);
    socket.on(EMERGENCY_EVENTS.new, refresh);
    return () => {
      socket.off(EMERGENCY_EVENTS.updated, refresh);
      socket.off(EMERGENCY_EVENTS.new, refresh);
    };
  }, [reload]);

  const send = useCallback(
    async (details: SosDetails): Promise<SosDeliveryStatus> => {
      if (busy) return session.deliveryStatus;
      setBusy(true);
      // Same key for every attempt of this alert — retries dedupe, they can
      // never create a second emergency record (see SosSession).
      const idempotencyKey = session.beginAttempt();
      setStatus('sending');
      try {
        const coordinates = details.shareLocation ? await readPosition() : {};
        const parsed = emergencySosSchema.safeParse({
          trip_id: tripId,
          type: details.type,
          message: details.message.trim() || null,
          ...coordinates,
        });
        if (!parsed.success) {
          session.markFailed();
          setStatus('failed');
          Alert.alert(crewCopy.sos.sendFailed, parsed.error.issues[0]?.message ?? t('sos.invalid'));
          return 'failed';
        }
        unwrapEnvelope(await apiClient.raiseSos(parsed.data, withIdempotencyKey(idempotencyKey)));
        session.markSent();
        setStatus('sent');
        setSentAt(formatTime(new Date()));
        // Delivered. This is the one announcement that interrupts whatever is
        // being said (see PRIORITY_EVENTS) — the driver must hear it now.
        feedback.on({ type: 'sos.fired' });
        await reload();
        return 'sent';
      } catch (caught) {
        if (shouldQueueAfterError(caught)) {
          // Nothing reached the server: keep the key, show "queued ⏳", the
          // reconnect effect below retries automatically. A *different*
          // pattern from 'sent' on purpose — "not yet delivered" is the whole
          // message, and hearing "sent" here would be a lie.
          session.markQueued();
          setStatus('queued');
          feedback.on({ type: 'sos.queued' });
          return 'queued';
        }
        session.markFailed();
        setStatus('failed');
        feedback.on({ type: 'action.rejected' });
        Alert.alert(crewCopy.sos.sendFailed, localizedErrorText(caught));
        return 'failed';
      } finally {
        setBusy(false);
      }
    },
    [busy, reload, session, tripId],
  );

  /** The one entry point: hold completed → fire with these details. */
  const fire = useCallback(
    (details: Partial<SosDetails> = {}) => {
      lastDetails.current = { ...DEFAULT_DETAILS, ...details };
      return send(lastDetails.current);
    },
    [send],
  );

  /** Manual retry (also used by the automatic reconnect below). */
  const retry = useCallback(() => send(lastDetails.current), [send]);

  // Automatic retry: back online and an attempt still queued → replay the
  // SAME key. Runs once per connectivity flip, never in a loop.
  const network = useNetworkStatus();
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (network === 'online' && statusRef.current === 'queued') {
      void retry();
    }
  }, [network, retry]);

  const active = history.find((event) => isEmergencyActive(event.status)) ?? null;

  return { status, sentAt, busy, active, history, reload, fire, retry };
}

/** Status line under the SOS button: sent ✅ / queued ⏳ / active alert. */
export const SosStatusLine: React.FC<{
  status: SosDeliveryStatus;
  sentAt: string | null;
  active: EmergencyEventResponse | null;
  onRetry: () => void;
  busy?: boolean;
}> = ({ status, sentAt, active, onRetry, busy = false }) => {
  useTranslation();
  if (active) {
    return (
      <View style={styles.statusLine}>
        <Ionicons name="alert-circle" size={22} color={colors.status.danger} />
        <Text style={styles.statusText}>{crewCopy.sos.activeAlert}</Text>
      </View>
    );
  }
  if (status === 'sent') {
    return (
      <View style={styles.statusLine}>
        <Ionicons name="checkmark-circle" size={22} color={colors.secondary[600]} />
        <Text style={styles.statusText}>
          {crewCopy.sos.sent}
          {sentAt ? ` · ${sentAt}` : ''}
        </Text>
      </View>
    );
  }
  if (status === 'queued') {
    return (
      <View style={styles.statusLine}>
        <Ionicons name="cloud-offline" size={22} color={colors.neutral[600]} />
        <Text style={[styles.statusText, styles.flexText]}>{crewCopy.sos.queued}</Text>
        <Button
          label={crewCopy.gps.retry}
          icon="refresh"
          variant="secondary"
          size="md"
          onPress={onRetry}
          busy={busy}
        />
      </View>
    );
  }
  if (status === 'sending') {
    return (
      <View style={styles.statusLine}>
        <Ionicons name="cloud-upload" size={22} color={colors.neutral[600]} />
        <Text style={styles.statusText}>{crewCopy.sos.retrying}</Text>
      </View>
    );
  }
  return null;
};

/**
 * The trip-screen SOS row (Phase 2): one hold button, its status, and the
 * pointer to the SOS tab for details/cancel. The full panel below shares
 * the same hook, so both surfaces behave identically.
 */
export const SosQuickPanel: React.FC<{
  tripId: string | null;
  onOpenSosTab: () => void;
}> = ({ tripId, onOpenSosTab }) => {
  useTranslation();
  const { status, sentAt, busy, active, fire, retry } = useCrewSos(tripId);
  return (
    <View style={styles.quickWrap}>
      <HoldToConfirmButton
        label={crewCopy.sos.holdLabel}
        icon="warning"
        onFire={() => void fire()}
        busy={busy}
        accessibilityLabel={crewCopy.sos.a11yLabel}
      />
      <SosStatusLine status={status} sentAt={sentAt} active={active} onRetry={retry} busy={busy} />
      {active ? (
        <Button
          label={crewCopy.sos.manageHint}
          icon="open-outline"
          variant="secondary"
          size="md"
          onPress={onOpenSosTab}
        />
      ) : null}
    </View>
  );
};

export const SosPanel: React.FC<SosPanelProps> = ({ tripId, roleLabel }) => {
  const { status, sentAt, busy, active, history, fire, retry, reload } = useCrewSos(tripId);
  const [composing, setComposing] = useState(false);
  const [type, setType] = useState<EmergencyType>(EmergencyType.ACCIDENT);
  const [message, setMessage] = useState('');
  const [shareLocation, setShareLocation] = useState(true);
  const [pendingCancel, setPendingCancel] = useState<EmergencyEventResponse | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);

  const raiseFromSheet = () => {
    void fire({ type, message, shareLocation }).then((result) => {
      // A confirmed or queued alert closes the sheet; a server rejection
      // keeps it open so the reason is visible next to the fields.
      if (result !== 'failed') {
        setComposing(false);
        setMessage('');
      }
    });
  };

  const cancel = async () => {
    if (!pendingCancel) return;
    setCancelBusy(true);
    try {
      unwrapEnvelope(await apiClient.cancelMyEmergency(pendingCancel.id));
      setPendingCancel(null);
      await reload();
    } catch (caught) {
      Alert.alert(t('sos.cancelFailed'), localizedErrorText(caught));
    } finally {
      setCancelBusy(false);
    }
  };

  const typeOptions: SelectOption[] = EMERGENCY_TYPE_VALUES.map((value) => ({
    value,
    label: EMERGENCY_TYPE_LABELS[value],
  }));

  return (
    <View>
      {active ? (
        <Card legible title={t('sos.activeTitle')}>
          <View style={styles.activeRow}>
            <Ionicons name="alert-circle" size={24} color={colors.status.danger} />
            <Text style={styles.activeText}>
              {EMERGENCY_TYPE_LABELS[active.type]} · {EMERGENCY_STATUS_LABELS[active.status]} ·{' '}
              {formatRelative(active.triggered_at)}
            </Text>
          </View>
          <Text style={styles.muted}>
            {active.acknowledged_at ? t('sos.acknowledged') : t('sos.notified')}
          </Text>
          <Button
            label={t('sos.cancelAlert')}
            variant="secondary"
            size="lg"
            icon="close-circle"
            onPress={() => setPendingCancel(active)}
            busy={cancelBusy}
            style={styles.action}
          />
        </Card>
      ) : null}

      <Card
        legible
        title={t('sos.cardTitle')}
        description={tripId ? t('sos.cardBodyTrip') : t('sos.cardBodyNoTrip')}
      >
        <Text style={styles.muted}>{t('sos.noReadingNeeded', { role: roleLabel })}</Text>
        <HoldToConfirmButton
          label={crewCopy.sos.holdLabel}
          icon="warning"
          onFire={() => void fire()}
          busy={busy}
          accessibilityLabel={crewCopy.sos.a11yLabel}
          style={styles.action}
        />
        <SosStatusLine
          status={status}
          sentAt={sentAt}
          active={active}
          onRetry={retry}
          busy={busy}
        />
        <Button
          label={t('sos.detailsButton')}
          icon="options"
          variant="ghost"
          size="md"
          onPress={() => setComposing(true)}
          disabled={busy}
          style={styles.detailsButton}
        />
      </Card>

      {history.length > 0 ? (
        <Card legible title={t('sos.recentTitle')}>
          {history.map((event) => (
            <View key={event.id} style={styles.historyRow}>
              <Ionicons
                name={event.status === EmergencyStatus.RESOLVED ? 'checkmark-circle' : 'time'}
                size={20}
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
                size="lg"
                label={EMERGENCY_STATUS_LABELS[event.status]}
                tone={emergencyStatusTone(event.status)}
              />
            </View>
          ))}
        </Card>
      ) : null}

      <FormSheet
        open={composing}
        title={t('sos.sheetTitle')}
        onClose={() => setComposing(false)}
        footer={
          <>
            <Button
              label={t('sos.back')}
              variant="secondary"
              size="lg"
              onPress={() => setComposing(false)}
              style={styles.flex}
            />
            <HoldToConfirmButton
              label={crewCopy.sos.holdLabel}
              icon="warning"
              onFire={raiseFromSheet}
              busy={busy}
              style={styles.flex}
            />
          </>
        }
      >
        <Select
          label={t('sos.typeLabel')}
          value={type}
          options={typeOptions}
          onChange={(value) => setType(value as EmergencyType)}
        />
        <Field
          label={t('sos.messageLabel')}
          value={message}
          onChangeText={setMessage}
          multiline
          placeholder={t('sos.messagePlaceholder')}
        />
        <SwitchRow
          label={t('sos.locationLabel')}
          hint={t('sos.locationHint')}
          value={shareLocation}
          onChange={setShareLocation}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingCancel)}
        title={t('sos.cancelTitle')}
        message={t('sos.cancelMessage')}
        confirmLabel={t('sos.cancelConfirm')}
        danger
        busy={cancelBusy}
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
  flexText: { flex: 1 },
  quickWrap: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 32,
  },
  statusText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[800],
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  activeText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  muted: {
    fontSize: 14,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
  action: {
    marginTop: spacing.md,
    borderRadius: borderRadius.md,
  },
  detailsButton: {
    marginTop: spacing.sm,
    alignSelf: 'flex-start',
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 4,
  },
  historyText: {
    flex: 1,
    fontSize: 14,
    color: colors.neutral[700],
  },
});
