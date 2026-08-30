import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  RouteAssignmentRole,
  type BusListResponse,
  type BusResponse,
  type ConductorListResponse,
  type DriverListResponse,
  type RouteAssignmentCreateRequest,
  type RouteAssignmentListResponse,
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
  LoadingView,
  Screen,
  SearchBar,
  Select,
  SwitchRow,
  useToast,
} from '../../../src/components';
import {
  ACTIVE_FILTER_OPTIONS,
  filterByActive,
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

  const { data, loading, error, reload } = useLoad(async (): Promise<{
    assignments: RouteAssignmentResponse[];
    routes: RouteResponse[];
    buses: BusResponse[];
    drivers: StaffResponse[];
    conductors: StaffResponse[];
  }> => {
    const [assignments, routes, buses, drivers, conductors] = await Promise.all([
      apiClient.listAssignments({ page: 1, limit: 100 }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
      apiClient.listBuses({ page: 1, limit: 100 }),
      apiClient.listDrivers({ page: 1, limit: 100 }),
      apiClient.listConductors({ page: 1, limit: 100 }),
    ]);
    return {
      assignments: unwrapEnvelope<RouteAssignmentListResponse>(assignments).items,
      routes: unwrapEnvelope<RouteListResponse>(routes).items,
      buses: unwrapEnvelope<BusListResponse>(buses).items,
      drivers: unwrapEnvelope<DriverListResponse>(drivers).items,
      conductors: unwrapEnvelope<ConductorListResponse>(conductors).items,
    };
  }, []);

  // Search + role + active filters, applied over the loaded assignment page
  // (the endpoint takes page/limit/search/role/is_active; search is applied
  // client-side here so the crew name and bus text are also matchable).
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RouteAssignmentRole | 'ALL'>('ALL');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    let rows = data?.assignments ?? [];
    if (roleFilter !== 'ALL') rows = rows.filter((row) => row.role === roleFilter);
    rows = filterByActive(rows, activeFilter);
    if (term) {
      rows = rows.filter((row) =>
        [
          row.route_code,
          row.route_name,
          row.user_name,
          row.user_email,
          row.bus_number,
          row.bus_registration_number,
        ]
          .filter((value): value is string => Boolean(value))
          .some((value) => value.toLowerCase().includes(term)),
      );
    }
    return rows;
  }, [data, search, roleFilter, activeFilter]);

  const filtersActive =
    search.trim().length > 0 || roleFilter !== 'ALL' || activeFilter !== 'ALL';
  const resetFilters = () => {
    setSearch('');
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
      await reload();
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
      await reload();
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

  if (loading && !data) {
    return <LoadingView label="Loading assignments…" />;
  }
  if (error || !data) {
    return (
      <Screen>
        <ErrorState message={error ?? 'Could not load assignments'} onRetry={() => void reload()} />
      </Screen>
    );
  }

  const staffOptions = (form.role === RouteAssignmentRole.CONDUCTOR ? data.conductors : data.drivers).map(
    (person) => ({ value: person.id, label: `${fullName(person)} (${person.email})` }),
  );

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void reload()} refreshing={loading} extraBottomSpace={72}>
        <SearchBar
          value={search}
          onChangeText={setSearch}
          onClear={() => setSearch('')}
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
            label={`${visible.length} of ${data.assignments.length} assignments`}
            onClear={resetFilters}
          />
        ) : null}

        {visible.length === 0 ? (
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
        ) : (
          visible.map((row) => (
            <ListCard
              key={row.id}
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
          ))
        )}
      </Screen>

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
          options={data.routes.map((route) => ({
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
          options={data.buses.map((bus) => ({
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
  dispatchRow: {
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
});
