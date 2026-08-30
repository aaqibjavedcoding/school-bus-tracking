import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type {
  RouteCreateRequest,
  RouteResponse,
  RouteUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { routeCreateSchema, routeUpdateSchema } from '@school-bus-tracking/validation';
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

const EMPTY = { name: '', code: '', description: '', is_active: true };

/** School-admin route management — CRUD parity with the web Routes page. */
export default function ManageRoutesScreen() {
  const router = useRouter();
  const toast = useToast();
  const list = usePagedResource<RouteResponse>(
    async (page, search) => unwrapEnvelope(await apiClient.listRoutes({ page, limit: 20, search })),
    [],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RouteResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RouteResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (route: RouteResponse) => {
    setEditing(route);
    setForm({
      name: route.name,
      code: route.code,
      description: route.description ?? '',
      is_active: route.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const payload: RouteCreateRequest = {
      name: form.name.trim(),
      code: form.code.trim(),
      description: emptyToNull(form.description),
      is_active: form.is_active,
    };
    const parsed = editing
      ? routeUpdateSchema.safeParse(payload)
      : routeCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateRoute(editing.id, parsed.data as RouteUpdateRequest));
        toast.push('Route updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createRoute(parsed.data as RouteCreateRequest));
        toast.push('Route created.', 'success');
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
      await apiClient.deleteRoute(pendingDelete.id);
      toast.push('Route removed.', 'success');
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
        <SearchBar value={list.search} onChangeText={list.setSearch} placeholder="Search routes…" />

        {list.loading && list.items.length === 0 ? (
          <LoadingView label="Loading routes…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={list.search ? 'No routes match' : 'No routes yet'}
            description={
              list.search
                ? `Nothing matched “${list.search}”.`
                : 'Create a route, then add stops in sequence.'
            }
          />
        ) : (
          <>
            <Text style={styles.count}>{list.meta.total} routes</Text>
            {list.items.map((route) => (
              <ListCard
                key={route.id}
                title={`${route.code} · ${route.name}`}
                subtitle={route.description}
                meta={[
                  route.student_count != null ? `${route.student_count} students` : null,
                  route.driver_name ? `Driver ${route.driver_name}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'Tap to manage stops'}
                right={
                  <Badge
                    label={route.is_active ? 'Active' : 'Inactive'}
                    tone={route.is_active ? 'success' : 'neutral'}
                  />
                }
                onPress={() => router.push(`/manage/routes/${route.id}`)}
                onEdit={() => startEdit(route)}
                onDelete={() => setPendingDelete(route)}
              />
            ))}
            <Pagination meta={list.meta} onPage={list.setPage} />
          </>
        )}
      </Screen>

      <Fab onPress={startCreate} label="Add route" />

      <FormSheet
        open={open}
        title={editing ? 'Edit route' : 'Add route'}
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
          label="Code"
          value={form.code}
          onChangeText={(text) => setForm({ ...form, code: text })}
          autoCapitalize="characters"
          error={fieldErrors.code}
        />
        <Field
          label="Description"
          value={form.description}
          onChangeText={(text) => setForm({ ...form, description: text })}
          multiline
          autoCapitalize="sentences"
          style={styles.textArea}
          error={fieldErrors.description}
        />
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete route?"
        message={pendingDelete ? `${pendingDelete.name} and its stop plan will be removed.` : ''}
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
  textArea: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
});
