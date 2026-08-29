import React, { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { borderRadius, colors, spacing } from '@school-bus-tracking/design-tokens';
import {
  routeCreateSchema,
  routeUpdateSchema,
  stopCreateSchema,
  stopUpdateSchema,
} from '@school-bus-tracking/validation';
import type { StopResponse } from '@school-bus-tracking/shared-types';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { TextField } from '../../../../src/components/TextField';
import { Button } from '../../../../src/components/Button';
import { ListRow } from '../../../../src/components/ListRow';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { LoadingView } from '../../../../src/components/Feedback';
import { useToast } from '../../../../src/components/Toast';
import { confirmAction } from '../../../../src/components/Confirm';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useLoad } from '../../../../src/hooks/use-load';
import {
  AdminFormScreen,
  messageFromError,
  zodFieldErrors,
} from '../../../../src/features/admin/admin-shared';

/**
 * Route detail + stop management (Task 23 §C): create/edit the route, list
 * its stops, add/edit/reorder/delete stops. Reordering goes through
 * `PUT /routes/:id/stops` (the whole ordered manifest — the API renumbers
 * 1..N), never a client-side assumption about sequences.
 */
export default function RouteDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const toast = useToast();

  const [editingStop, setEditingStop] = useState<StopResponse | null>(null);
  const [routeForm, setRouteForm] = useState({
    name: '',
    code: '',
    description: '',
    is_active: true,
  });
  const [routeErrors, setRouteErrors] = useState<Record<string, string>>({});
  const [routeBanner, setRouteBanner] = useState<string | null>(null);
  const [savingRoute, setSavingRoute] = useState(false);

  const detail = useLoad(async () => {
    if (isNew) return null;
    const routeEnvelope = await api.getRoute(id);
    const stopsEnvelope = await api.listRouteStops(id).catch(() => null);
    return { route: routeEnvelope.data ?? null, stops: stopsEnvelope?.data?.items ?? [] };
  }, [id]);

  React.useEffect(() => {
    if (detail.data?.route) {
      setRouteForm({
        name: detail.data.route.name,
        code: detail.data.route.code,
        description: detail.data.route.description ?? '',
        is_active: detail.data.route.is_active,
      });
    }
  }, [detail.data?.route]);

  const saveRoute = async (): Promise<void> => {
    setRouteBanner(null);
    const payload = {
      name: routeForm.name.trim(),
      code: routeForm.code.trim().toUpperCase(),
      ...(routeForm.description.trim() ? { description: routeForm.description.trim() } : {}),
      is_active: routeForm.is_active,
    };
    const parsed = (isNew ? routeCreateSchema : routeUpdateSchema).safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error);
      setRouteErrors(fieldErrors);
      setRouteBanner(Object.values(fieldErrors)[0] ?? 'Please correct the highlighted fields.');
      return;
    }
    setSavingRoute(true);
    try {
      if (isNew) {
        const created = await api.createRoute(parsed.data as never);
        toast.show('Route created — add stops next.', 'success');
        if (created.data?.id) {
          router.replace(`/admin/routes/${created.data.id}` as never);
        } else {
          router.back();
        }
      } else {
        await api.updateRoute(id, parsed.data as never);
        toast.show('Route updated.', 'success');
        void detail.reload();
      }
    } catch (error) {
      setRouteBanner(messageFromError(error, 'Could not save the route.'));
    } finally {
      setSavingRoute(false);
    }
  };

  const stops = useMemo(
    () => (detail.data?.stops ?? []).slice().sort((a, b) => a.sequence_number - b.sequence_number),
    [detail.data],
  );

  const moveStop = async (index: number, delta: -1 | 1): Promise<void> => {
    const target = index + delta;
    if (target < 0 || target >= stops.length) {
      return;
    }
    const next = stops.slice();
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    try {
      await api.reorderRouteStops(id, { stop_ids: next.map((stop) => stop.id) });
      toast.show('Stop order saved.', 'success');
      void detail.reload();
    } catch (error) {
      toast.show(messageFromError(error, 'Could not reorder stops.'), 'danger');
    }
  };

  const removeStop = async (stop: StopResponse): Promise<void> => {
    const ok = await confirmAction(
      `Delete “${stop.name}”?`,
      'Students assigned to this stop must be moved first (the API enforces it).',
      {
        confirmLabel: 'Delete stop',
        destructive: true,
      },
    );
    if (!ok) return;
    try {
      await api.deleteStop(stop.id);
      toast.show('Stop deleted.', 'success');
      void detail.reload();
    } catch (error) {
      toast.show(messageFromError(error, 'Could not delete the stop.'), 'danger');
    }
  };

  return (
    <Screen>
      <AdminFormScreen
        onSave={() => void saveRoute()}
        busy={savingRoute}
        banner={routeBanner}
        saveLabel={isNew ? 'Create route' : 'Save route'}
      >
        <TextField
          label="Route name"
          value={routeForm.name}
          error={routeErrors.name}
          onChangeText={(v) => setRouteForm({ ...routeForm, name: v })}
        />
        <TextField
          label="Route code"
          autoCapitalize="characters"
          value={routeForm.code}
          error={routeErrors.code}
          onChangeText={(v) => setRouteForm({ ...routeForm, code: v })}
        />
        <TextField
          label="Description"
          value={routeForm.description}
          onChangeText={(v) => setRouteForm({ ...routeForm, description: v })}
        />
        <Button
          label={routeForm.is_active ? 'Status: active' : 'Status: inactive'}
          variant="secondary"
          onPress={() => setRouteForm({ ...routeForm, is_active: !routeForm.is_active })}
        />
      </AdminFormScreen>

      {!isNew ? (
        <Card
          title={`Stops (${stops.length})`}
          description="Ordered from first pickup to final drop."
          right={<StatusBadge tone="info" label={`${stops.length} STOPS`} compact />}
        >
          {detail.loading ? <LoadingView label="Loading stops…" /> : null}
          {stops.map((stop, index) => (
            <StopRow
              key={stop.id}
              stop={stop}
              index={index}
              total={stops.length}
              onMove={(delta) => void moveStop(index, delta)}
              onEdit={() => setEditingStop(stop)}
              onDelete={() => void removeStop(stop)}
            />
          ))}
          <StopFormModal
            routeId={id}
            triggerLabel={stops.length === 0 ? 'Add the first stop' : 'Add stop'}
            onSaved={() => void detail.reload()}
          />
          {editingStop ? (
            <StopFormModal
              routeId={id}
              stop={editingStop}
              hideTrigger
              onDismiss={() => setEditingStop(null)}
              onSaved={() => {
                setEditingStop(null);
                void detail.reload();
              }}
            />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

const StopRow: React.FC<{
  stop: StopResponse;
  index: number;
  total: number;
  onMove: (delta: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ stop, index, total, onMove, onEdit, onDelete }) => (
  <View style={styles.stopRow}>
    <ListRow
      title={`${stop.sequence_number}. ${stop.name}`}
      subtitle={stop.address ?? undefined}
      meta={
        stop.latitude != null && stop.longitude != null
          ? `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)} · geofence ${stop.geofence_radius_meters} m${stop.estimated_arrival_time ? ` · ETA ${stop.estimated_arrival_time}` : ''}`
          : 'No coordinates — the map skips it'
      }
      right={
        <View style={styles.stopButtons}>
          <Button
            label="↑"
            small
            variant="ghost"
            disabled={index === 0}
            onPress={() => onMove(-1)}
          />
          <Button
            label="↓"
            small
            variant="ghost"
            disabled={index === total - 1}
            onPress={() => onMove(1)}
          />
          <Button label="Edit" small variant="secondary" onPress={onEdit} />
          <Button label="✕" small variant="danger" onPress={onDelete} />
        </View>
      }
    />
  </View>
);

/** Add / edit stop via bottom sheet (same create/update endpoints as web). */
export const StopFormModal: React.FC<{
  routeId: string;
  stop?: StopResponse | null;
  triggerLabel?: string;
  hideTrigger?: boolean;
  onDismiss?: () => void;
  onSaved: () => void;
}> = ({
  routeId,
  stop = null,
  triggerLabel = 'Add stop',
  hideTrigger = false,
  onDismiss,
  onSaved,
}) => {
  const api = getGlobalSession().apiClient;
  const toast = useToast();
  const [open, setOpen] = useState(Boolean(stop));
  const isEdit = Boolean(stop);
  const [form, setForm] = useState({
    name: stop?.name ?? '',
    address: stop?.address ?? '',
    latitude: stop?.latitude != null ? String(stop.latitude) : '',
    longitude: stop?.longitude != null ? String(stop.longitude) : '',
    geofence_radius_meters: stop ? String(stop.geofence_radius_meters) : '',
    estimated_arrival_time: stop?.estimated_arrival_time ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      ...(form.address.trim() ? { address: form.address.trim() } : {}),
      ...(form.latitude.trim() ? { latitude: Number(form.latitude) } : {}),
      ...(form.longitude.trim() ? { longitude: Number(form.longitude) } : {}),
      ...(form.geofence_radius_meters.trim()
        ? { geofence_radius_meters: Number(form.geofence_radius_meters) }
        : {}),
      ...(form.estimated_arrival_time.trim()
        ? { estimated_arrival_time: form.estimated_arrival_time.trim() }
        : {}),
    };
    if (!isEdit) {
      payload.route_id = routeId;
    }
    const parsed = (isEdit ? stopUpdateSchema : stopCreateSchema).safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error as never);
      setErrors(fieldErrors);
      return;
    }
    setBusy(true);
    try {
      if (isEdit && stop) {
        await api.updateStop(stop.id, parsed.data as never);
      } else {
        await api.createStop(parsed.data as never);
      }
      toast.show(isEdit ? 'Stop updated.' : 'Stop added.', 'success');
      setOpen(false);
      onDismiss?.();
      onSaved();
    } catch (error) {
      toast.show(messageFromError(error, 'Could not save the stop.'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {hideTrigger ? null : (
        <Button label={triggerLabel} variant="secondary" onPress={() => setOpen(true)} fullWidth />
      )}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setOpen(false);
          onDismiss?.();
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>{isEdit ? `Edit “${stop?.name}”` : 'New stop'}</Text>
            <ScrollView keyboardShouldPersistTaps="handled">
              <TextField
                label="Stop name"
                value={form.name}
                error={errors.name}
                onChangeText={(v) => setForm({ ...form, name: v })}
              />
              <TextField
                label="Address"
                value={form.address}
                onChangeText={(v) => setForm({ ...form, address: v })}
              />
              <TextField
                label="Latitude"
                keyboardType="numbers-and-punctuation"
                placeholder="e.g. 40.7128"
                value={form.latitude}
                error={errors.latitude}
                onChangeText={(v) => setForm({ ...form, latitude: v })}
              />
              <TextField
                label="Longitude"
                keyboardType="numbers-and-punctuation"
                placeholder="e.g. -74.0060"
                value={form.longitude}
                error={errors.longitude}
                onChangeText={(v) => setForm({ ...form, longitude: v })}
              />
              <TextField
                label="Geofence radius (m)"
                keyboardType="number-pad"
                placeholder="120"
                value={form.geofence_radius_meters}
                error={errors.geofence_radius_meters}
                onChangeText={(v) => setForm({ ...form, geofence_radius_meters: v })}
                hint="Arrivals are detected by the backend from this radius."
              />
              <TextField
                label="Estimated arrival time"
                placeholder="07:25"
                value={form.estimated_arrival_time}
                error={errors.estimated_arrival_time}
                onChangeText={(v) => setForm({ ...form, estimated_arrival_time: v })}
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setOpen(false);
                  onDismiss?.();
                }}
              />
              <Button
                label={busy ? 'Saving…' : 'Save stop'}
                busy={busy}
                onPress={() => void save()}
              />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  stopRow: {
    marginBottom: spacing.xs,
  },
  stopButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    padding: spacing.md,
    maxHeight: '85%',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: colors.neutral[900],
    marginBottom: spacing.md,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
});
