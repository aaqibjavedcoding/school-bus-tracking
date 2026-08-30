import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  BusCreateRequest,
  BusResponse,
  BusUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { busCreateSchema, busUpdateSchema } from '@school-bus-tracking/validation';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../src/lib/errors';
import { usePagedResource } from '../../../src/hooks/usePagedResource';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Fab,
  Field,
  FormSheet,
  ListCard,
  LoadingView,
  Pagination,
  Screen,
  SearchBar,
  SwitchRow,
  useToast,
} from '../../../src/components';

const EMPTY = { registration_number: '', bus_number: '', capacity: '40', is_active: true };

/** School-admin bus management — full CRUD parity with the web Buses page. */
export default function ManageBusesScreen() {
  const toast = useToast();
  const list = usePagedResource<BusResponse>(
    async (page, search) => unwrapEnvelope(await apiClient.listBuses({ page, limit: 20, search })),
    [],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<BusResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<BusResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (bus: BusResponse) => {
    setEditing(bus);
    setForm({
      registration_number: bus.registration_number,
      bus_number: bus.bus_number ?? '',
      capacity: String(bus.capacity),
      is_active: bus.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const payload: BusCreateRequest = {
      registration_number: form.registration_number.trim(),
      bus_number: emptyToNull(form.bus_number),
      capacity: Number(form.capacity),
      is_active: form.is_active,
    };
    const parsed = editing ? busUpdateSchema.safeParse(payload) : busCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateBus(editing.id, parsed.data as BusUpdateRequest));
        toast.push('Bus updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createBus(parsed.data as BusCreateRequest));
        toast.push('Bus added.', 'success');
      }
      setOpen(false);
      await list.reload();
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
      await apiClient.deleteBus(pendingDelete.id);
      toast.push('Bus removed.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void list.reload()} refreshing={list.loading}>
        <SearchBar
          value={list.search}
          onChangeText={list.setSearch}
          placeholder="Search registration or fleet number…"
        />

        {list.loading && list.items.length === 0 ? (
          <LoadingView label="Loading buses…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={list.search ? 'No buses match' : 'No buses yet'}
            description={
              list.search
                ? `Nothing matched “${list.search}”.`
                : 'Add a vehicle before creating route assignments.'
            }
          />
        ) : (
          <>
            <Text style={styles.count}>{list.meta.total} buses</Text>
            {list.items.map((bus) => (
              <ListCard
                key={bus.id}
                title={bus.registration_number}
                subtitle={
                  bus.assigned_route_name
                    ? `Route ${bus.assigned_route_code ?? ''} · ${bus.assigned_route_name}`
                    : null
                }
                meta={`${bus.bus_number ? `Fleet ${bus.bus_number} · ` : ''}${bus.capacity} seats`}
                right={
                  <Badge
                    label={bus.is_active ? 'Active' : 'Inactive'}
                    tone={bus.is_active ? 'success' : 'neutral'}
                  />
                }
                onEdit={() => startEdit(bus)}
                onDelete={() => setPendingDelete(bus)}
              />
            ))}
            <Pagination meta={list.meta} onPage={list.setPage} />
          </>
        )}
      </Screen>

      <Fab onPress={startCreate} label="Add bus" />

      <FormSheet
        open={open}
        title={editing ? 'Edit bus' : 'Add bus'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={styles.flex} />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Field
          label="Registration number"
          value={form.registration_number}
          onChangeText={(text) => setForm({ ...form, registration_number: text })}
          autoCapitalize="characters"
          error={fieldErrors.registration_number}
        />
        <Field
          label="Fleet number"
          value={form.bus_number}
          onChangeText={(text) => setForm({ ...form, bus_number: text })}
          error={fieldErrors.bus_number}
        />
        <Field
          label="Capacity"
          value={form.capacity}
          onChangeText={(text) => setForm({ ...form, capacity: text })}
          keyboardType="number-pad"
          error={fieldErrors.capacity}
        />
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete bus?"
        message={
          pendingDelete
            ? `${pendingDelete.registration_number} will be removed from the fleet.`
            : ''
        }
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
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
});
