import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { StaffCreateRequest, StaffResponse } from '@school-bus-tracking/shared-types';
import { staffCreateSchema, staffUpdateSchema } from '@school-bus-tracking/validation';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../src/lib/errors';
import { fullName } from '../../../src/lib/format';
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
  SegmentedControl,
  SwitchRow,
  useToast,
} from '../../../src/components';

type Segment = 'drivers' | 'conductors';

const EMPTY = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  phone: '',
  is_active: true,
};

/**
 * School-admin crew management — CRUD parity with the web "Drivers &
 * conductors" page, including account creation, password reset on edit and
 * activation state.
 */
export default function ManageStaffScreen() {
  const toast = useToast();
  const [segment, setSegment] = useState<Segment>('drivers');

  const list = usePagedResource<StaffResponse>(
    async (page, search) => {
      if (segment === 'drivers') {
        const data = unwrapEnvelope(await apiClient.listDrivers({ page, limit: 20, search }));
        return { items: data.items as StaffResponse[], meta: data.meta };
      }
      const data = unwrapEnvelope(await apiClient.listConductors({ page, limit: 20, search }));
      return { items: data.items as StaffResponse[], meta: data.meta };
    },
    [segment],
  );

  // Client-side active/inactive narrowing over the loaded page (the staff
  // endpoints expose page/limit/search only — no `is_active` query param).
  const activeFilter = useActiveFilter(list.items);
  const visible = activeFilter.visible;
  const filtersActive = Boolean(list.activeSearch) || activeFilter.isFiltered;
  const resetFilters = () => {
    list.clearSearch();
    activeFilter.reset();
  };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StaffResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StaffResponse | null>(null);

  const noun = segment === 'drivers' ? 'driver' : 'conductor';

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (person: StaffResponse) => {
    setEditing(person);
    setForm({
      first_name: person.first_name,
      last_name: person.last_name,
      email: person.email,
      password: '',
      phone: person.phone ?? '',
      is_active: person.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const base: StaffCreateRequest = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: emptyToNull(form.phone),
      is_active: form.is_active,
    };
    if (editing) {
      const updateBody = {
        first_name: base.first_name,
        last_name: base.last_name,
        email: base.email,
        phone: base.phone,
        is_active: base.is_active,
        ...(form.password ? { password: form.password } : {}),
      };
      const parsed = staffUpdateSchema.safeParse(updateBody);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        return;
      }
      setBusy(true);
      try {
        if (segment === 'drivers') {
          unwrapEnvelope(await apiClient.updateDriver(editing.id, parsed.data));
        } else {
          unwrapEnvelope(await apiClient.updateConductor(editing.id, parsed.data));
        }
        toast.push('Account updated.', 'success');
        setOpen(false);
        await list.reload();
      } catch (caught) {
        setFieldErrors(fieldErrorsFromUnknown(caught));
        toast.push(getApiErrorMessage(caught), 'danger');
      } finally {
        setBusy(false);
      }
      return;
    }

    const parsed = staffCreateSchema.safeParse(base);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (segment === 'drivers') {
        unwrapEnvelope(await apiClient.createDriver(parsed.data));
      } else {
        unwrapEnvelope(await apiClient.createConductor(parsed.data));
      }
      toast.push('Account created.', 'success');
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
      if (segment === 'drivers') {
        await apiClient.deleteDriver(pendingDelete.id);
      } else {
        await apiClient.deleteConductor(pendingDelete.id);
      }
      toast.push('Account removed.', 'success');
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
        keyExtractor={(person) => person.id}
        renderItem={({ item }) => (
          <ListCard
            title={fullName(item)}
            subtitle={item.email}
            meta={[
              item.phone,
              item.assigned_route_name ? `Route ${item.assigned_route_code ?? ''}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            right={
              <Badge
                label={item.is_active ? 'Active' : 'Inactive'}
                tone={item.is_active ? 'success' : 'neutral'}
              />
            }
            onEdit={() => startEdit(item)}
            onDelete={() => setPendingDelete(item)}
          />
        )}
        header={
          <>
            <SegmentedControl<Segment>
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'drivers', label: 'Drivers' },
                { value: 'conductors', label: 'Conductors' },
              ]}
            />
            <SearchBar
              value={list.search}
              onChangeText={list.setSearch}
              onClear={list.clearSearch}
              searching={list.searching}
              placeholder="Search name or email…"
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
                  ? `${visible.length} of ${list.meta.total} ${segment}`
                  : `${list.meta.total} ${segment}`}
              </Text>
            ) : null}
          </>
        }
        footer={
          visible.length > 0 ? <Pagination meta={list.meta} onPage={list.setPage} /> : null
        }
        empty={
          list.loading && list.items.length === 0 ? (
            <LoadingView label={`Loading ${segment}…`} />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          ) : (
            <EmptyState
              title={filtersActive ? 'No matches' : `No ${segment} yet`}
              description={
                filtersActive
                  ? `No ${segment} match the current search or filters.`
                  : `Create a ${noun} account, then assign them to a route.`
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

      <Fab onPress={startCreate} label={`Add ${noun}`} />

      <FormSheet
        open={open}
        title={editing ? `Edit ${noun}` : `Add ${noun}`}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={styles.flex} />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Field
          label="First name"
          value={form.first_name}
          onChangeText={(text) => setForm({ ...form, first_name: text })}
          autoCapitalize="words"
          error={fieldErrors.first_name}
        />
        <Field
          label="Last name"
          value={form.last_name}
          onChangeText={(text) => setForm({ ...form, last_name: text })}
          autoCapitalize="words"
          error={fieldErrors.last_name}
        />
        <Field
          label="Email"
          value={form.email}
          onChangeText={(text) => setForm({ ...form, email: text })}
          keyboardType="email-address"
          autoCapitalize="none"
          error={fieldErrors.email}
        />
        <Field
          label={editing ? 'New password (optional)' : 'Password'}
          value={form.password}
          onChangeText={(text) => setForm({ ...form, password: text })}
          secureTextEntry
          error={fieldErrors.password}
        />
        <Field
          label="Phone"
          value={form.phone}
          onChangeText={(text) => setForm({ ...form, phone: text })}
          keyboardType="phone-pad"
          error={fieldErrors.phone}
        />
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete account?"
        message={pendingDelete ? `${fullName(pendingDelete)} will no longer be able to sign in.` : ''}
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
