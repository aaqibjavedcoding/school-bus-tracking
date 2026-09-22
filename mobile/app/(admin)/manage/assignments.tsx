import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  RunCrewRole,
  type ConductorListResponse,
  type DriverListResponse,
  type RunCrewCreateRequest,
  type RunCrewListResponse,
  type RunCrewResponse,
  type RunCrewUpdateRequest,
  type RunListResponse,
  type RunResponse,
  type TripResponse,
} from '@school-bus-tracking/shared-types';
import { runCrewCreateSchema, runCrewUpdateSchema } from '@school-bus-tracking/validation';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../src/lib/errors';
import { fullName, utcDateOnly } from '../../../src/lib/format';
import { runLabel } from '../../../src/lib/runs';
import { useLoad } from '../../../src/hooks/useLoad';
import {
  Badge,
  Button,
  ConfirmDialog,
  DatePicker,
  EmptyState,
  ErrorState,
  FilterChips,
  FilterSummary,
  Fab,
  FormSheet,
  ListCard,
  ListScreen,
  LoadingView,
  SearchBar,
  Select,
  SwitchRow,
  useToast,
} from '../../../src/components';
import { ACTIVE_FILTER_OPTIONS, type ActiveFilter } from '../../../src/hooks/useActiveFilter';

const EMPTY = {
  run_id: '',
  user_id: '',
  role: RunCrewRole.DRIVER as RunCrewRole,
  effective_from: utcDateOnly(),
  effective_to: '',
  is_active: true,
};

/**
 * School-admin crew roster — the mobile home of the **run-crew** rows
 * (one person, one role, one run, one validity window), the operating model
 * that replaced the retired route-assignment writes.
 *
 * The run-crew list endpoints are per-run (`GET /runs/:id/crew`), so the
 * screen loads every run and fans out one crew request per run, then filters
 * on the device — the roster of one school is small, and this keeps the
 * whole screen on the live API (no deprecated `listAssignments`).
 *
 * Creating a row is end-to-end: pick run → role → person → dates → save, and
 * the row is immediately dispatchable ("Dispatch now" posts `run_id`).
 */
export default function ManageAssignmentsScreen() {
  const router = useRouter();
  const toast = useToast();

  // ---- Roster (runs × their crew rows) -----------------------------------
  const [rows, setRows] = useState<RunCrewResponse[]>([]);
  const [runs, setRuns] = useState<RunResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    setLoadError(null);
    try {
      const runsEnvelope = await apiClient.listRuns({ limit: 100 });
      const runItems = unwrapEnvelope<RunListResponse>(runsEnvelope).items;
      const crews = await Promise.all(
        runItems.map((run) => apiClient.listRunCrew(run.id, { limit: 100 })),
      );
      setRuns(runItems);
      setRows(crews.flatMap((crew) => unwrapEnvelope<RunCrewListResponse>(crew).items));
    } catch (caught) {
      setLoadError(getApiErrorMessage(caught));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runById = useMemo(() => new Map(runs.map((run) => [run.id, run] as const)), [runs]);

  // ---- Filters (client-side over the loaded roster) -----------------------
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RunCrewRole | 'ALL'>('ALL');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('ALL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (roleFilter !== 'ALL' && row.role !== roleFilter) return false;
      if (activeFilter !== 'ALL' && row.is_active !== (activeFilter === 'ACTIVE')) return false;
      if (!q) return true;
      const run = runById.get(row.run_id);
      const haystack = [
        row.run_code,
        row.route_code,
        row.route_name,
        row.user_name,
        row.user_email,
        run?.code,
        run?.bus_number,
        run?.bus_registration_number,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, runById, roleFilter, activeFilter, search]);

  const filtersActive = search !== '' || roleFilter !== 'ALL' || activeFilter !== 'ALL';
  const resetFilters = () => {
    setSearch('');
    setRoleFilter('ALL');
    setActiveFilter('ALL');
  };

  // ---- Form lookups (people pickers only) ----------------------------------
  const lookups = useLoad(async (): Promise<{
    drivers: DriverListResponse['items'];
    conductors: ConductorListResponse['items'];
  }> => {
    const [drivers, conductors] = await Promise.all([
      apiClient.listDrivers({ page: 1, limit: 100 }),
      apiClient.listConductors({ page: 1, limit: 100 }),
    ]);
    return {
      drivers: unwrapEnvelope<DriverListResponse>(drivers).items,
      conductors: unwrapEnvelope<ConductorListResponse>(conductors).items,
    };
  }, []);

  // ---- Form state -----------------------------------------------------------
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RunCrewResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RunCrewResponse | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (row: RunCrewResponse) => {
    setEditing(row);
    setForm({
      run_id: row.run_id,
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
    if (form.run_id === '') {
      setFieldErrors({ run_id: 'Select a run' });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        // `run_id` is immutable — a roster row moves to another run only by
        // creating a new row (the API rejects the field on PATCH).
        const payload: RunCrewUpdateRequest = {
          user_id: form.user_id,
          role: form.role,
          effective_from: form.effective_from.trim(),
          effective_to: form.effective_to.trim() || null,
          is_active: form.is_active,
        };
        const parsed = runCrewUpdateSchema.safeParse(payload);
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.updateRunCrew(editing.id, parsed.data));
        toast.push('Assignment updated.', 'success');
      } else {
        const payload: RunCrewCreateRequest = {
          user_id: form.user_id,
          role: form.role,
          effective_from: form.effective_from.trim(),
          effective_to: form.effective_to.trim() || null,
          is_active: form.is_active,
        };
        const parsed = runCrewCreateSchema.safeParse(payload);
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.createRunCrew(form.run_id, parsed.data));
        toast.push('Assignment created.', 'success');
      }
      setOpen(false);
      await load();
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
      await apiClient.deleteRunCrew(pendingDelete.id);
      toast.push('Assignment removed.', 'success');
      setPendingDelete(null);
      await load();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const dispatch = (row: RunCrewResponse) => {
    Alert.alert(
      'Dispatch trip now',
      `Create a trip from this roster row${row.route_code ? ` on route ${row.route_code}` : ''}? The scheduled start is set to now.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Dispatch',
          onPress: () => {
            void (async () => {
              setDispatchingId(row.id);
              try {
                const trip = unwrapEnvelope<TripResponse>(
                  await apiClient.createTrip({
                    run_id: row.run_id,
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

  const runOptions = useMemo(
    () =>
      [...runs]
        .sort(
          (a, b) =>
            (a.route_code ?? '').localeCompare(b.route_code ?? '') || a.code.localeCompare(b.code),
        )
        .map((run) => ({ value: run.id, label: runLabel(run) })),
    [runs],
  );

  const staffOptions = (
    form.role === RunCrewRole.CONDUCTOR
      ? (lookups.data?.conductors ?? [])
      : (lookups.data?.drivers ?? [])
  ).map((person) => ({ value: person.id, label: `${fullName(person)} (${person.email})` }));

  return (
    <View style={styles.flex}>
      <ListScreen
        data={filtered}
        keyExtractor={(row) => row.id}
        renderItem={({ item: row }) => {
          const run = runById.get(row.run_id);
          return (
            <ListCard
              title={
                row.route_code
                  ? `${row.route_code} · ${row.route_name ?? ''}`.trim()
                  : (row.run_code ?? 'Run')
              }
              subtitle={`${row.role === RunCrewRole.DRIVER ? 'Driver' : 'Conductor'}: ${row.user_name ?? '—'}`}
              meta={`${run?.bus_registration_number ?? run?.bus_number ?? 'No bus'} · ${row.effective_from}${row.effective_to ? ` → ${row.effective_to}` : ' → open'}`}
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
          );
        }}
        header={
          <>
            <SearchBar
              value={search}
              onChangeText={setSearch}
              onClear={() => setSearch('')}
              placeholder="Search route, crew or bus…"
            />
            <FilterChips<RunCrewRole | 'ALL'>
              options={[
                { value: 'ALL', label: 'All roles' },
                { value: RunCrewRole.DRIVER, label: 'Drivers' },
                { value: RunCrewRole.CONDUCTOR, label: 'Conductors' },
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
                  search ? `“${search}”` : null,
                  roleFilter !== 'ALL'
                    ? roleFilter === RunCrewRole.DRIVER
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
            {filtered.length > 0 ? (
              <Text style={styles.count}>
                {filtersActive
                  ? `${filtered.length} of ${rows.length} assignments`
                  : `${rows.length} assignments`}
              </Text>
            ) : null}
          </>
        }
        footer={null}
        empty={
          loading ? (
            <LoadingView label="Loading assignments…" />
          ) : loadError ? (
            <ErrorState message={loadError} onRetry={() => void load()} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="No assignments"
              description="Roster a driver or conductor onto a run, then dispatch trips from here."
              action={<Button label="New assignment" onPress={startCreate} />}
            />
          ) : filtersActive ? (
            <EmptyState
              title="No matching assignments"
              description="No assignments match the current search or filters."
              action={<Button label="Clear filters" variant="secondary" onPress={resetFilters} />}
            />
          ) : null
        }
        refresh={() => void load()}
        refreshing={refreshing}
        extraBottomSpace={72}
      />

      <Fab onPress={startCreate} label="New" />

      <FormSheet
        open={open}
        title={editing ? 'Edit assignment' : 'New assignment'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setOpen(false)}
              style={styles.flex}
            />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Select
          label="Run"
          value={form.run_id}
          onChange={(value) => setForm({ ...form, run_id: value })}
          options={runOptions}
          placeholder="Select run"
          error={fieldErrors.run_id}
        />
        <Select
          label="Role"
          value={form.role}
          onChange={(value) =>
            // The person picker is per-role: a driver id is meaningless on
            // the conductor list, so the selection cannot survive the swap.
            setForm({ ...form, role: value as RunCrewRole, user_id: '' })
          }
          options={[
            { value: RunCrewRole.DRIVER, label: 'Driver' },
            { value: RunCrewRole.CONDUCTOR, label: 'Conductor' },
          ]}
          error={fieldErrors.role}
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
            <DatePicker
              label="From"
              value={form.effective_from}
              onChange={(value) => setForm({ ...form, effective_from: value })}
              error={fieldErrors.effective_from}
            />
          </View>
          <View style={styles.flex}>
            <DatePicker
              label="To (optional)"
              value={form.effective_to}
              onChange={(value) => setForm({ ...form, effective_to: value })}
              placeholder="Open ended"
              allowClear
              minDate={form.effective_from === '' ? null : form.effective_from}
              error={fieldErrors.effective_to}
            />
          </View>
        </View>
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
        {runs.length === 0 ? (
          <Text style={styles.warn}>
            No runs yet — create one under Routes → Runs first, then roster crew onto it here.
          </Text>
        ) : null}
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
    fontSize: 14,
    marginBottom: spacing.sm,
  },
  dispatchRow: {
    marginTop: spacing.sm,
    alignItems: 'flex-start',
  },
  warn: {
    color: colors.status.warning,
    fontSize: 14,
    marginTop: spacing.xs,
  },
});
