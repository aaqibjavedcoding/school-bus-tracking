import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  RouteAssignmentRole,
  type BusListResponse,
  type BusResponse,
  type ConductorListResponse,
  type DriverListResponse,
  type RouteAssignmentCreateRequest,
  type RouteAssignmentResponse,
  type RouteListResponse,
  type RouteResponse,
  type StaffResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import {
  routeAssignmentCreateSchema,
  routeAssignmentUpdateSchema,
} from '@school-bus-tracking/validation';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../src/lib/errors';
import { fullName, utcDateOnly } from '../../../src/lib/format';
import { useLoad } from '../../../src/hooks/useLoad';
import { usePagedResource } from '../../../src/hooks/usePagedResource';
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
  Select,
  SwitchRow,
  useToast,
} from '../../../src/components';
import {
  ACTIVE_FILTER_OPTIONS,
  type ActiveFilter,
} from '../../../src/hooks/useActiveFilter';

const EMPTY = {
  route_id: '',
  bus_id: '',
  user_id: '',
  role: RouteAssignmentRole.DRIVER as RouteAssignmentRole,
  effective_from: utcDateOnly(),
  effective_to: '',
  is_active: true,
};

/**
 * School-admin route assignments — CRUD parity with the web Assignments
 * page, plus one-tap dispatch (create a trip now from an active assignment).
 */
export default function ManageAssignmentsScreen() {
  const router = useRouter();
  const toast = useToast();

  // Lookups feed the create / edit form selects only; the roster itself is
  // paginated and filtered server-side below.
  const lookups = useLoad(async (): Promise<{
    routes: RouteResponse[];
    buses: BusResponse[];
    drivers: StaffResponse[];
    conductors: StaffResponse[];
  }> => {
    const [routes, buses, drivers, conductors] = await Promise.all([
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listBuses({ page: 1, limit: 100 }),
      apiClient.listDrivers({ page: 1, limit: 100 }),
      apiClient.listConductors({ page: 1, limit: 100 }),
    ]);
    return {
      routes: unwrapEnvelope<RouteListResponse>(routes).items,
      buses: unwrapEnvelope<BusListResponse>(buses).items,
      drivers: unwrapEnvelope<DriverListResponse>(drivers).items,
      conductors: unwrapEnvelope<ConductorListResponse>(conductors).items,
    };
  }, []);

  const [roleFilter, setRoleFilter] = useState<RouteAssignmentRole | 'ALL'>('ALL');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');

  // Reuse the server-side search + role + is_active filters (the endpoint
  // takes page/limit/search/role/is_active) instead of narrowing a single
  // 100-row page on the device — same debounce and stale-response guard as
  // every other admin list.
  const list = usePagedResource<RouteAssignmentResponse>(
    async (page, search) =>
      unwrapEnvelope(
        await apiClient.listAssignments({
          page,
          limit: 20,
          search: search || undefined,
          role: roleFilter === 'ALL' ? undefined : roleFilter,
          is_active: activeFilter === 'ALL' ? undefined : activeFilter === 'ACTIVE',
        }),
      ),
    [roleFilter, activeFilter],
  );

  const filtersActive =
    Boolean(list.activeSearch) || roleFilter !== 'ALL' || activeFilter !== 'ALL';
  const resetFilters = () => {
    list.clearSearch();
    setRoleFilter('ALL');
    setActiveFilter('ALL');
  };

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RouteAssignmentResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RouteAssignmentResponse | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (row: RouteAssignmentResponse) => {
    setEditing(row);
    setForm({
      route_id: row.route_id,
      bus_id: row.bus_id ?? '',
      user_id: row.user_id,
      role: row.role,
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? '',
      is_active: row.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const payload: RouteAssignmentCreateRequest = {
      route_id: form.route_id,
      bus_id: form.bus_id,
      user_id: form.user_id,
      role: form.role,
      effective_from: form.effective_from,
      effective_to: emptyToNull(form.effective_to),
      is_active: form.is_active,
    };
    const parsed = editing
      ? routeAssignmentUpdateSchema.safeParse(payload)
      : routeAssignmentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateAssignment(editing.id, parsed.data));
        toast.push('Assignment updated.', 'success');
      } else {
        unwrapEnvelope(
          await apiClient.createAssignment(parsed.data as RouteAssignmentCreateRequest),
        );
        toast.push('Assignment created.', 'success');
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
      await apiClient.deleteAssignment(pendingDelete.id);
      toast.push('Assignment removed.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const dispatch = (assignment: RouteAssignmentResponse) => {
    Alert.alert(
      'Dispatch trip now',
      `Create a trip from this assignment${assignment.route_code ? ` on route ${assignment.route_code}` : ''}? The scheduled start is set to now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dispatch',
          onPress: () => {
            void (async () => {
              setDispatchingId(assignment.id);
              try {
                const trip = unwrapEnvelope<TripResponse>(
                  await apiClient.createTrip({
                    route_assignment_id: assignment.id,
                    scheduled_start_at: new Date().toISOString(),
                  }),
                );
                toast.push('Trip dispatched.', 'success');
                router.push(`/trips/${trip.id}`);
              } catch (caught) {
                toast.push(getApiErrorMessage(caught, 'Could not dispatch the trip.'), 'danger');
              } finally {
                setDispatchingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const staffOptions = (
    form.role === RouteAssignmentRole.CONDUCTOR
      ? lookups.data?.conductors ?? []
      : lookups.data?.drivers ?? []
  ).map((person) => ({ value: person.id, label: `${fullName(person)} (${person.email})` }));

  return (
    <View style={styles.flex}>
      <ListScreen
        data={list.items}
        keyExtractor={(row) => row.id}
        renderItem={({ item: row }) => (
          <ListCard
            title={row.route_code ? `${row.route_code} · ${row.route_name ?? ''}`.trim() : 'Route'}
            subtitle={`${row.role === RouteAssignmentRole.DRIVER ? 'Driver' : 'Conductor'}: ${row.user_name ?? '—'}`}
            meta={`${row.bus_registration_number ?? row.bus_number ?? 'No bus'} · ${row.effective_from}${row.effective_to ? ` → ${row.effective_to}` : ' → open'}`}
            right={
              <Badge
                label={row.is_active ? 'Active' : 'Inactive'}
                tone={row.is_active ? 'success' : 'neutral'}
              />
            }
            onEdit={() => startEdit(row)}
            onDelete={() => setPendingDelete(row)}
          >
            {row.is_active ? (
              <View style={styles.dispatchRow}>
                <Button
                  label="Dispatch now"
                  small
                  onPress={() => dispatch(row)}
                  busy={dispatchingId === row.id}
                  disabled={dispatchingId !== null}
                />
              </View>
            ) : null}
          </ListCard>
        )}
        header={
          <>
            <SearchBar
              value={list.search}
              onChangeText={list.setSearch}
              onClear={list.clearSearch}
              searching={list.searching}
              placeholder="Search route, crew or bus…"
            />
            <FilterChips<RouteAssignmentRole | 'ALL'>
              options={[
                { value: 'ALL', label: 'All roles' },
                { value: RouteAssignmentRole.DRIVER, label: 'Drivers' },
                { value: RouteAssignmentRole.CONDUCTOR, label: 'Conductors' },
              ]}
              value={roleFilter}
              onChange={setRoleFilter}
            />
            <FilterChips<ActiveFilter>
              options={ACTIVE_FILTER_OPTIONS}
              value={activeFilter}
              onChange={setActiveFilter}
            />
            {filtersActive ? (
              <FilterSummary
                label={[
                  list.activeSearch ? `“${list.activeSearch}”` : null,
                  roleFilter !== 'ALL'
                    ? roleFilter === RouteAssignmentRole.DRIVER
                      ? 'Drivers'
                      : 'Conductors'
                    : null,
                  activeFilter !== 'ALL'
                    ? activeFilter === 'ACTIVE'
                      ? 'Active'
                      : 'Inactive'
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                onClear={resetFilters}
              />
            ) : null}
            {list.items.length > 0 ? (
              <Text style={styles.count}>
                {filtersActive
                  ? `${list.items.length} of ${list.meta.total} assignments`
                  : `${list.meta.total} assignments`}
              </Text>
            ) : null}
          </>
        }
        footer={
          list.items.length > 0 ? <Pagination meta={list.meta} onPage={list.setPage} /> : null
        }
        empty={
          list.loading && list.items.length === 0 ? (
            <LoadingView label="Loading assignments…" />
          ) : list.error ? (
            <ErrorState message={list.error} onRetry={() => void list.reload()} />
          ) : (
            <EmptyState
              title={filtersActive ? 'No matching assignments' : 'No assignments'}
              description={
                filtersActive
                  ? 'No assignments match the current search or filters.'
                  : 'Create a roster row before dispatching trips.'
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

      <Fab onPress={startCreate} label="New" />

      <FormSheet
        open={open}
        title={editing ? 'Edit assignment' : 'New assignment'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={styles.flex} />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Select
          label="Role"
          value={form.role}
          onChange={(value) =>
            setForm({ ...form, role: value as RouteAssignmentRole, user_id: '' })
          }
          options={[
            { value: RouteAssignmentRole.DRIVER, label: 'Driver' },
            { value: RouteAssignmentRole.CONDUCTOR, label: 'Conductor' },
          ]}
          error={fieldErrors.role}
        />
        <Select
          label="Route"
          value={form.route_id}
          onChange={(value) => setForm({ ...form, route_id: value })}
          options={(lookups.data?.routes ?? []).map((route) => ({
            value: route.id,
            label: `${route.name} (${route.code})`,
          }))}
          placeholder="Select route"
          error={fieldErrors.route_id}
        />
        <Select
          label="Bus"
          value={form.bus_id}
          onChange={(value) => setForm({ ...form, bus_id: value })}
          options={(lookups.data?.buses ?? []).map((bus) => ({
            value: bus.id,
            label: bus.registration_number,
          }))}
          placeholder="Select bus"
          error={fieldErrors.bus_id}
        />
        <Select
          label="Crew member"
          value={form.user_id}
          onChange={(value) => setForm({ ...form, user_id: value })}
          options={staffOptions}
          placeholder="Select person"
          error={fieldErrors.user_id}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="From (YYYY-MM-DD)"
              value={form.effective_from}
              onChangeText={(text) => setForm({ ...form, effective_from: text })}
              autoCapitalize="none"
              error={fieldErrors.effective_from}
            />
          </View>
          <View style={styles.flex}>
            <Field
              label="To (optional)"
              value={form.effective_to}
              onChangeText={(text) => setForm({ ...form, effective_to: text })}
              autoCapitalize="none"
              error={fieldErrors.effective_to}
            />
          </View>
        </View>
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete assignment?"
        message="This roster row will no longer be available for new trips."
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
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  dispatchRow: {
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
});
