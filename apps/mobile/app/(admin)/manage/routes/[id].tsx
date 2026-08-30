import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type {
  RouteResponse,
  RouteStopsListResponse,
  StopCreateRequest,
  StopResponse,
  StopUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { stopCreateSchema, stopUpdateSchema } from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../../src/services/api';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../src/lib/errors';
import { invalidIdMessage, isUuid } from '../../../../src/lib/ids';
import { stopCode } from '../../../../src/lib/format';
import { useLoad } from '../../../../src/hooks/useLoad';
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
  SearchBar,
  SwitchRow,
  useToast,
} from '../../../../src/components';

const EMPTY = {
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  geofence_radius_meters: '100',
  estimated_arrival_time: '',
  is_active: true,
};

/**
 * Route detail — the ordered stop plan with create / edit / delete and
 * up/down reorder, matching the web route detail page. The sequence is the
 * boarding order used by trip manifests.
 */
export default function ManageRouteStopsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const routeId = typeof id === 'string' ? id : '';
  const usableId = isUuid(routeId);

  const { data, loading, error, reload, setData } = useLoad(async (): Promise<{
    route: RouteResponse;
    stops: StopResponse[];
  }> => {
    if (!usableId) throw new Error(invalidIdMessage('route'));
    const [routeEnvelope, stopsEnvelope] = await Promise.all([
      apiClient.getRoute(routeId),
      apiClient.listRouteStops(routeId),
    ]);
    return {
      route: unwrapEnvelope<RouteResponse>(routeEnvelope),
      stops: unwrapEnvelope<RouteStopsListResponse>(stopsEnvelope).items,
    };
  }, [routeId, usableId]);

  // Stop search. Reordering stays disabled while a search is active because
  // the up/down arrows operate on the full boarding sequence.
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const visibleStops = useMemo(() => {
    const stops = data?.stops ?? [];
    if (!term) return stops;
    return stops.filter((stop) =>
      [stop.name, stop.address].some((value) => value?.toLowerCase().includes(term)),
    );
  }, [data, term]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StopResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StopResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (stop: StopResponse) => {
    setEditing(stop);
    setForm({
      name: stop.name,
      address: stop.address ?? '',
      latitude: stop.latitude == null ? '' : String(stop.latitude),
      longitude: stop.longitude == null ? '' : String(stop.longitude),
      geofence_radius_meters: String(stop.geofence_radius_meters),
      estimated_arrival_time: stop.estimated_arrival_time ?? '',
      is_active: stop.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const payload: StopCreateRequest = {
      route_id: routeId,
      name: form.name.trim(),
      address: emptyToNull(form.address),
      latitude: form.latitude.trim() ? Number(form.latitude) : null,
      longitude: form.longitude.trim() ? Number(form.longitude) : null,
      geofence_radius_meters: form.geofence_radius_meters
        ? Number(form.geofence_radius_meters)
        : undefined,
      estimated_arrival_time: emptyToNull(form.estimated_arrival_time),
      is_active: form.is_active,
    };
    const parsed = editing ? stopUpdateSchema.safeParse(payload) : stopCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateStop(editing.id, parsed.data as StopUpdateRequest));
        toast.push('Stop updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createStop(parsed.data as StopCreateRequest));
        toast.push('Stop added.', 'success');
      }
      setOpen(false);
      await reload();
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const move = async (index: number, direction: -1 | 1) => {
    if (!data) return;
    const next = data.stops.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);
    setData({ ...data, stops: next });
    try {
      const envelope = await apiClient.reorderRouteStops(routeId, {
        stop_ids: next.map((stop) => stop.id),
      });
      setData({ ...data, stops: unwrapEnvelope<RouteStopsListResponse>(envelope).items });
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
      await reload();
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    try {
      await apiClient.deleteStop(pendingDelete.id);
      toast.push('Stop removed.', 'success');
      setPendingDelete(null);
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <LoadingView label="Loading route…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Route not found'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void reload()} refreshing={loading} extraBottomSpace={72}>
        <Pressable onPress={() => router.back()} style={styles.backRow} accessibilityRole="button">
          <Text style={styles.backText}>‹ All routes</Text>
        </Pressable>

        <Text style={styles.title}>
          {data.route.code} · {data.route.name}
        </Text>
        {data.route.description ? (
          <Text style={styles.subtitle}>{data.route.description}</Text>
        ) : null}
        <Text style={styles.hint}>Order is the boarding sequence used for trip manifests.</Text>

        {data.stops.length > 0 ? (
          <SearchBar
            value={search}
            onChangeText={setSearch}
            onClear={() => setSearch('')}
            placeholder="Search stops…"
          />
        ) : null}

        {visibleStops.length === 0 ? (
          <EmptyState
            title={term ? 'No matching stops' : 'No stops yet'}
            description={
              term
                ? `Nothing matched “${search.trim()}”.`
                : 'Add the first boarding point with the button below.'
            }
            action={
              term ? (
                <Button label="Clear search" variant="secondary" onPress={() => setSearch('')} />
              ) : null
            }
          />
        ) : (
          visibleStops.map((stop) => {
            const index = data.stops.findIndex((entry) => entry.id === stop.id);
            return (
            <View key={stop.id} style={styles.stopCard}>
              <View style={styles.stopTop}>
                <View style={styles.seqBadge}>
                  <Text style={styles.seqText}>{stop.sequence_number}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.stopName}>
                    {stop.name}{' '}
                    {!stop.is_active ? <Text style={styles.inactive}>(inactive)</Text> : null}
                  </Text>
                  <Text style={styles.stopMeta}>
                    {stopCode(data.route.code, stop.sequence_number)}
                    {stop.estimated_arrival_time ? ` · ETA ${stop.estimated_arrival_time}` : ''}
                  </Text>
                  <Text style={styles.stopMeta}>
                    {stop.latitude != null && stop.longitude != null
                      ? `${stop.latitude.toFixed(5)}, ${stop.longitude.toFixed(5)}`
                      : 'No coordinates'}
                  </Text>
                </View>
              </View>
              <View style={styles.stopActions}>
                <Pressable
                  onPress={() => void move(index, -1)}
                  disabled={index <= 0 || Boolean(term)}
                  style={[
                    styles.iconBtn,
                    index <= 0 || term ? styles.iconBtnDisabled : null,
                  ]}
                  accessibilityLabel="Move stop up"
                >
                  <Ionicons name="arrow-up" size={16} color={colors.neutral[700]} />
                </Pressable>
                <Pressable
                  onPress={() => void move(index, 1)}
                  disabled={index === data.stops.length - 1 || Boolean(term)}
                  style={[
                    styles.iconBtn,
                    index === data.stops.length - 1 || term ? styles.iconBtnDisabled : null,
                  ]}
                  accessibilityLabel="Move stop down"
                >
                  <Ionicons name="arrow-down" size={16} color={colors.neutral[700]} />
                </Pressable>
                <View style={styles.spacer} />
                <Pressable onPress={() => startEdit(stop)} style={styles.textBtn} hitSlop={6}>
                  <Ionicons name="create-outline" size={16} color={colors.primary[700]} />
                  <Text style={styles.textBtnLabel}>Edit</Text>
                </Pressable>
                <Pressable onPress={() => setPendingDelete(stop)} style={styles.textBtn} hitSlop={6}>
                  <Ionicons name="trash-outline" size={16} color={colors.status.danger} />
                  <Text style={[styles.textBtnLabel, { color: colors.status.danger }]}>Delete</Text>
                </Pressable>
              </View>
            </View>
            );
          })
        )}
      </Screen>

      <Fab onPress={startCreate} label="Add stop" />

      <FormSheet
        open={open}
        title={editing ? 'Edit stop' : 'Add stop'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={styles.flex} />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Field
          label="Name"
          value={form.name}
          onChangeText={(text) => setForm({ ...form, name: text })}
          autoCapitalize="words"
          error={fieldErrors.name}
        />
        <Field
          label="Address"
          value={form.address}
          onChangeText={(text) => setForm({ ...form, address: text })}
          autoCapitalize="words"
          error={fieldErrors.address}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="Latitude"
              value={form.latitude}
              onChangeText={(text) => setForm({ ...form, latitude: text })}
              keyboardType="numbers-and-punctuation"
              error={fieldErrors.latitude}
            />
          </View>
          <View style={styles.flex}>
            <Field
              label="Longitude"
              value={form.longitude}
              onChangeText={(text) => setForm({ ...form, longitude: text })}
              keyboardType="numbers-and-punctuation"
              error={fieldErrors.longitude}
            />
          </View>
        </View>
        <Field
          label="Geofence radius (m)"
          value={form.geofence_radius_meters}
          onChangeText={(text) => setForm({ ...form, geofence_radius_meters: text })}
          keyboardType="number-pad"
          error={fieldErrors.geofence_radius_meters}
        />
        <Field
          label="Estimated arrival (HH:MM)"
          value={form.estimated_arrival_time}
          onChangeText={(text) => setForm({ ...form, estimated_arrival_time: text })}
          autoCapitalize="none"
          error={fieldErrors.estimated_arrival_time}
        />
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete stop?"
        message={pendingDelete ? `${pendingDelete.name} will be removed from this route.` : ''}
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
  row: { flexDirection: 'row', gap: spacing.sm },
  backRow: { alignSelf: 'flex-start', marginBottom: spacing.sm },
  backText: { color: colors.primary[700], fontSize: 15, fontWeight: '600' },
  title: {
    fontSize: typography.fontSizes.xl,
    fontWeight: '800',
    color: colors.neutral[900],
  },
  subtitle: {
    fontSize: typography.fontSizes.sm,
    color: colors.neutral[600],
    marginTop: 2,
  },
  hint: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: spacing.xs,
    marginBottom: spacing.md,
  },
  stopCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  stopTop: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  seqBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  seqText: {
    color: colors.primary[800],
    fontWeight: '800',
    fontSize: typography.fontSizes.sm,
  },
  stopName: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  inactive: {
    color: colors.neutral[400],
    fontWeight: '500',
    fontSize: typography.fontSizes.xs,
  },
  stopMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  stopActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.neutral[100],
  },
  iconBtnDisabled: {
    opacity: 0.4,
  },
  spacer: {
    flex: 1,
  },
  textBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  textBtnLabel: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.primary[700],
  },
});
