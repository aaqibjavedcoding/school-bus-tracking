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
  ACTIVE_FILTER_OPTIONS,
  useActiveFilter,
  type ActiveFilter,
} from '../../../src/hooks/useActiveFilter';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FilterChips,
  FilterSummary,
  Fab,
  Field,
  FormSheet,
  ListCard,
  ListScreen,
  LoadingView,
  Pagination,
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

  // Client-side active/inactive narrowing over the loaded page (the list
  // endpoints expose page/limit/search only — no `is_active` query param).
  const activeFilter = useActiveFilter(list.items);
  const visible = activeFilter.visible;
  const filtersActive = Boolean(list.activeSearch) || activeFilter.isFiltered;
  const resetFilters = () => {
    list.clearSearch();
    activeFilter.reset();
  };

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
      <ListScreen
        data={visible}
        keyExtractor={(route) => route.id}
        renderItem={({ item }) => (
          <ListCard
            title={`${item.code} · ${item.name}`}
            subtitle={item.description}
            meta={[
              item.student_count != null ? `${item.student_count} students` : null,
              item.driver_name ? `Driver ${item.driver_name}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || 'Tap to manage stops'}
            right={
              <Badge
                label={item.is_active ? 'Active' : 'Inactive'}
                tone={item.is_active ? 'success' : 'neutral'}
              />
            }
            onPress={() => router.push(`/manage/routes/${item.id}`)}
            onEdit={() => startEdit(item)}
            onDelete={() => setPendingDelete(item)}
          />
        )}
        header={
          <>
            <SearchBar
              value={list.search}
              onChangeText={list.setSearch}
              onClear={list.clearSearch}
              searching={list.searching}
              placeholder="Search routes…"
            />
            <FilterChips<ActiveFilter>
              options={ACTIVE_FILTER_OPTIONS}
              value={activeFilter.filter}
              onChange={activeFilter.setFilter}
            />
            {filtersActive ? (
              <FilterSummary
                label={[
                  list.activeSearch ? `“${list.activeSearch}”` : null,
                  activeFilter.isFiltered ? activeFilter.label : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={resetFilters}
              />
            ) : null}
            {visible.length > 0 ? (
              <Text style={styles.count}>
                {filtersActive
                  ? `${visible.length} of ${list.meta.total} routes`
                  : `${list.meta.total} routes`}
              </Text>
            ) : null}
          </>
        }
        footer={
          visible.length > 0 ? <Pagination meta={list.meta} onPage={list.setPage} /> : null
        }
        empty={
          list.loading && list.items.length === 0 ? (
            <LoadingView label="Loading routes…" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          ) : (
            <EmptyState
              title={filtersActive ? 'No routes match' : 'No routes yet'}
              description={
                filtersActive
                  ? 'No routes match the current search or filters.'
                  : 'Create a route, then add stops in sequence.'
              }
              action={
                filtersActive ? (
                  <Button label="Clear filters" variant="secondary" onPress={resetFilters} />
                ) : null
              }
            />
          )
        }
        refresh={() => void list.reload()}
        refreshing={list.loading}
        extraBottomSpace={72}
      />

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
