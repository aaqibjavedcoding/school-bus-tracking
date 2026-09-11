import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  RunCrewRole,
  type BusListResponse,
  type BusResponse,
  type ConductorListResponse,
  type DriverListResponse,
  type RouteResponse,
  type RunCrewCreateRequest,
  type RunCrewListResponse,
  type RunCrewResponse,
  type RunCrewUpdateRequest,
  type RunListResponse,
  type RunResponse,
  type ShiftListResponse,
  type ShiftResponse,
} from '@school-bus-tracking/shared-types';
import {
  routeRunCreateSchema,
  runCrewCreateSchema,
  runCrewUpdateSchema,
  runUpdateSchema,
} from '@school-bus-tracking/validation';
import { colors, spacing, borderRadius, typography } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../../../src/services/api';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../../src/lib/errors';
import { invalidIdMessage, isUuid } from '../../../../../src/lib/ids';
import { fullName, utcDateOnly } from '../../../../../src/lib/format';
import { shiftLabel, shiftWindowLabel, windowsOverlapPreview } from '../../../../../src/lib/runs';
import { useLoad } from '../../../../../src/hooks/useLoad';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Fab,
  Field,
  FormSheet,
  ListScreen,
  LoadingView,
  Select,
  SwitchRow,
  useToast,
} from '../../../../../src/components';

const EMPTY_RUN = { code: '', shift_id: '', bus_id: '', is_active: true };

interface CrewFormState {
  user_id: string;
  role: RunCrewRole;
  effective_from: string;
  effective_to: string;
  is_active: boolean;
}

interface Lookups {
  route: RouteResponse;
  runs: RunResponse[];
  shifts: ShiftResponse[];
  buses: BusResponse[];
}

interface CrewState {
  rows: RunCrewResponse[];
  drivers: DriverListResponse['items'];
  conductors: ConductorListResponse['items'];
}

/**
 * Runs of one route (`docs/operating-model.md` Phase 3) — the mobile twin of
 * the web route-detail "Runs" panel: one vehicle's timed pass over this
 * route, with its bell window (shift), bus and per-run crew roster.
 *
 * All validation is delegated to the shared zod schemas (mirrors of the API
 * DTOs); the §4 conflict rules (same bus / same person in overlapping windows,
 * the undeletable default run, the 409 codes) live server-side and surface
 * verbatim — the UI only *pre-warns* on a bus-window clash, exactly like the
 * web editor.
 */
export default function ManageRouteRunsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const routeId = typeof id === 'string' ? id : '';
  const usableId = isUuid(routeId);

  const lookups = useLoad(async (): Promise<Lookups> => {
    if (!usableId) throw new Error(invalidIdMessage('route'));
    const [route, runs, shifts, buses] = await Promise.all([
      apiClient.getRoute(routeId),
      apiClient.listRouteRuns(routeId, { limit: 100 }),
      apiClient.listShifts({ limit: 100 }),
      apiClient.listBuses({ limit: 100 }),
    ]);
    return {
      route: unwrapEnvelope<RouteResponse>(route),
      runs: unwrapEnvelope<RunListResponse>(runs).items,
      shifts: unwrapEnvelope<ShiftListResponse>(shifts).items,
      buses: unwrapEnvelope<BusListResponse>(buses).items,
    };
  }, [routeId, usableId]);

  // ---- Run form -------------------------------------------------------------
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<RunResponse | null>(null);
  const [form, setForm] = useState(EMPTY_RUN);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<RunResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY_RUN);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (run: RunResponse) => {
    setEditing(run);
    setForm({
      code: run.code,
      shift_id: run.shift_id ?? '',
      bus_id: run.bus_id ?? '',
      is_active: run.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  // Pre-warning only: other runs of *this route* whose window clashes with the
  // pick. The API owns the school-wide verdict.
  const busClashCount = useMemo(() => {
    if (!form.bus_id || !lookups.data) return 0;
    const pickedShift = lookups.data.shifts.find((shift) => shift.id === form.shift_id);
    return lookups.data.runs.filter(
      (run) =>
        run.bus_id === form.bus_id &&
        run.id !== editing?.id &&
        windowsOverlapPreview(
          {
            start_time: pickedShift?.start_time ?? null,
            end_time: pickedShift?.end_time ?? null,
          },
          { start_time: run.shift_start_time ?? null, end_time: run.shift_end_time ?? null },
        ),
    ).length;
  }, [form.bus_id, form.shift_id, lookups.data, editing?.id]);

  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        const parsed = runUpdateSchema.safeParse({
          code: form.code.trim() || undefined,
          shift_id: form.shift_id || null,
          bus_id: form.bus_id || null,
          is_active: form.is_active,
        });
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.updateRun(editing.id, parsed.data));
        toast.push('Run updated.', 'success');
      } else {
        const parsed = routeRunCreateSchema.safeParse({
          ...(form.code.trim() ? { code: form.code.trim() } : {}),
          shift_id: form.shift_id || null,
          bus_id: form.bus_id || null,
          is_active: form.is_active,
        });
        if (!parsed.success) {
          setFieldErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.createRouteRun(routeId, parsed.data));
        toast.push('Run added.', 'success');
      }
      setOpen(false);
      await lookups.reload();
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
      await apiClient.deleteRun(pendingDelete.id);
      toast.push('Run retired.', 'success');
      setPendingDelete(null);
      await lookups.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  // ---- Run crew -------------------------------------------------------------
  const [crewRun, setCrewRun] = useState<RunResponse | null>(null);
  const [crew, setCrew] = useState<CrewState>({ rows: [], drivers: [], conductors: [] });
  const [crewLoading, setCrewLoading] = useState(false);
  const [crewEditing, setCrewEditing] = useState<RunCrewResponse | null>(null);
  const [crewForm, setCrewForm] = useState<CrewFormState>({
    user_id: '',
    role: RunCrewRole.DRIVER,
    effective_from: utcDateOnly(),
    effective_to: '',
    is_active: true,
  });
  const [crewErrors, setCrewErrors] = useState<Record<string, string>>({});
  const [crewBusy, setCrewBusy] = useState(false);
  const [pendingCrewDelete, setPendingCrewDelete] = useState<RunCrewResponse | null>(null);

  const resetCrewForm = () => {
    setCrewEditing(null);
    setCrewForm({
      user_id: '',
      role: RunCrewRole.DRIVER,
      effective_from: utcDateOnly(),
      effective_to: '',
      is_active: true,
    });
    setCrewErrors({});
  };

  const loadCrew = async (run: RunResponse) => {
    setCrewLoading(true);
    try {
      const [rows, drivers, conductors] = await Promise.all([
        apiClient.listRunCrew(run.id, { limit: 100 }),
        apiClient.listDrivers({ limit: 100 }),
        apiClient.listConductors({ limit: 100 }),
      ]);
      setCrew({
        rows: unwrapEnvelope<RunCrewListResponse>(rows).items,
        drivers: unwrapEnvelope<DriverListResponse>(drivers).items,
        conductors: unwrapEnvelope<ConductorListResponse>(conductors).items,
      });
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setCrewLoading(false);
    }
  };

  // Switching to another run's roster always starts from a clean form —
  // nothing typed for a previous run can leak into this one.
  const openCrew = (run: RunResponse) => {
    setCrewRun(run);
    resetCrewForm();
    setPendingCrewDelete(null);
    void loadCrew(run);
  };

  const startCrewEdit = (row: RunCrewResponse) => {
    setCrewEditing(row);
    setCrewForm({
      user_id: row.user_id,
      role: row.role,
      effective_from: row.effective_from,
      effective_to: row.effective_to ?? '',
      is_active: row.is_active,
    });
    setCrewErrors({});
  };

  const crewPeople = crewForm.role === RunCrewRole.DRIVER ? crew.drivers : crew.conductors;

  const saveCrew = async () => {
    if (!crewRun) return;
    setCrewBusy(true);
    try {
      if (crewEditing) {
        const payload: RunCrewUpdateRequest = {
          user_id: crewForm.user_id,
          role: crewForm.role,
          effective_from: crewForm.effective_from.trim(),
          effective_to: crewForm.effective_to.trim() || null,
          is_active: crewForm.is_active,
        };
        const parsed = runCrewUpdateSchema.safeParse(payload);
        if (!parsed.success) {
          setCrewErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.updateRunCrew(crewEditing.id, parsed.data));
        toast.push('Roster updated.', 'success');
      } else {
        const payload: RunCrewCreateRequest = {
          user_id: crewForm.user_id,
          role: crewForm.role,
          effective_from: crewForm.effective_from.trim(),
          effective_to: crewForm.effective_to.trim() || null,
          is_active: crewForm.is_active,
        };
        const parsed = runCrewCreateSchema.safeParse(payload);
        if (!parsed.success) {
          setCrewErrors(fieldErrorsFromZod(parsed.error));
          return;
        }
        unwrapEnvelope(await apiClient.createRunCrew(crewRun.id, parsed.data));
        toast.push('Crew rostered.', 'success');
      }
      resetCrewForm(); // Reset only after a failed-save-free round trip.
      await loadCrew(crewRun);
      await lookups.reload();
    } catch (caught) {
      setCrewErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setCrewBusy(false);
    }
  };

  const removeCrew = async () => {
    if (!pendingCrewDelete || !crewRun) return;
    setCrewBusy(true);
    try {
      await apiClient.deleteRunCrew(pendingCrewDelete.id);
      toast.push('Roster row removed.', 'success');
      setPendingCrewDelete(null);
      if (crewEditing?.id === pendingCrewDelete.id) resetCrewForm();
      await loadCrew(crewRun);
      await lookups.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setCrewBusy(false);
    }
  };

  if (lookups.loading && !lookups.data) {
    return <LoadingView label="Loading runs…" />;
  }
  if (lookups.error || !lookups.data) {
    return (
      <View style={styles.center}>
        <ErrorState
          message={lookups.error ?? 'Route not found'}
          onRetry={() => void lookups.reload()}
        />
      </View>
    );
  }

  const { route, runs, shifts, buses } = lookups.data;

  return (
    <View style={styles.flex}>
      <ListScreen
        data={runs}
        keyExtractor={(run) => run.id}
        renderItem={({ item: run }) => (
          <View style={styles.runCard}>
            <View style={styles.runTop}>
              <View style={{ flex: 1 }}>
                <Text style={styles.runTitle}>
                  {run.code}
                  {run.is_default ? <Text style={styles.defaultMark}> · default</Text> : null}
                  {!run.is_active ? <Text style={styles.inactive}> (inactive)</Text> : null}
                </Text>
                <Text style={styles.runMeta}>
                  {shiftWindowLabel(run)}
                  {' · '}
                  {run.bus_number ?? run.bus_registration_number ?? 'No bus'}
                </Text>
                <Text style={styles.runMeta}>
                  {[run.driver_name, run.conductor_name].filter(Boolean).join(' · ') || 'No crew'}
                  {` · ${run.student_count ?? 0} riders`}
                </Text>
              </View>
              <Badge
                label={run.is_active ? 'Active' : 'Inactive'}
                tone={run.is_active ? 'success' : 'neutral'}
              />
            </View>
            <View style={styles.runActions}>
              <Pressable onPress={() => openCrew(run)} style={styles.textBtn} hitSlop={6}>
                <Ionicons name="people-outline" size={16} color={colors.primary[700]} />
                <Text style={styles.textBtnLabel}>Crew</Text>
              </Pressable>
              <View style={styles.spacer} />
              <Pressable onPress={() => startEdit(run)} style={styles.textBtn} hitSlop={6}>
                <Ionicons name="create-outline" size={16} color={colors.primary[700]} />
                <Text style={styles.textBtnLabel}>Edit</Text>
              </Pressable>
              {!run.is_default ? (
                <Pressable onPress={() => setPendingDelete(run)} style={styles.textBtn} hitSlop={6}>
                  <Ionicons name="trash-outline" size={16} color={colors.status.danger} />
                  <Text style={[styles.textBtnLabel, { color: colors.status.danger }]}>Delete</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        )}
        header={
          <>
            <Pressable
              onPress={() => router.back()}
              style={styles.backRow}
              accessibilityRole="button"
            >
              <Text style={styles.backText}>‹ Route stops</Text>
            </Pressable>
            <Text style={styles.title}>Runs · {route.code}</Text>
            <Text style={styles.subtitle}>
              One vehicle's timed pass over {route.name} — bus, crew and bell window per run.
            </Text>
            {runs.length > 0 ? <Text style={styles.count}>{runs.length} runs</Text> : null}
          </>
        }
        empty={
          <EmptyState
            title="No runs yet"
            description="Until one exists this route behaves exactly like before the runs model."
          />
        }
        refresh={() => void lookups.refresh()}
        refreshing={lookups.refreshing}
        extraBottomSpace={72}
      />

      <Fab onPress={startCreate} label="Add run" />

      <FormSheet
        open={open}
        title={editing ? `Edit run ${editing.code}` : 'Add run'}
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
        <Field
          label="Code (optional)"
          value={form.code}
          onChangeText={(text) => setForm({ ...form, code: text })}
          placeholder={`${route.code}-2`}
          autoCapitalize="characters"
          error={fieldErrors.code}
        />
        <Select
          label="Shift (bell window)"
          value={form.shift_id}
          onChange={(value) => setForm({ ...form, shift_id: value })}
          options={[
            { value: '', label: 'All day (no shift)' },
            ...shifts.map((shift) => ({ value: shift.id, label: shiftLabel(shift) })),
          ]}
          placeholder="All day (no shift)"
          error={fieldErrors.shift_id}
        />
        <Select
          label="Bus"
          value={form.bus_id}
          onChange={(value) => setForm({ ...form, bus_id: value })}
          options={[
            { value: '', label: 'No bus yet' },
            ...buses.map((bus) => ({
              value: bus.id,
              label: `${bus.registration_number}${bus.bus_number ? ` · ${bus.bus_number}` : ''}`,
            })),
          ]}
          placeholder="No bus yet"
          error={fieldErrors.bus_id}
        />
        {busClashCount > 0 ? (
          <Text style={styles.warn}>
            This bus already has {busClashCount === 1 ? 'a run' : `${busClashCount} runs`} whose
            window overlaps on this route. Saving may be refused by the API.
          </Text>
        ) : null}
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Retire run?"
        message={
          pendingDelete
            ? `Run ${pendingDelete.code} will be removed. The API refuses while riders or history are attached.`
            : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Per-run crew roster: list + add/edit/delete. */}
      <FormSheet
        open={Boolean(crewRun)}
        title={crewRun ? `Crew · ${crewRun.code}` : 'Crew'}
        onClose={() => setCrewRun(null)}
      >
        {crewLoading && crew.rows.length === 0 ? (
          <LoadingView label="Loading roster…" />
        ) : (
          <>
            {crew.rows.length === 0 ? (
              <Text style={styles.crewEmpty}>Nobody rostered on this run yet.</Text>
            ) : (
              crew.rows.map((row) => (
                <View key={row.id} style={styles.crewRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.crewName}>
                      {row.user_name ?? row.user_email ?? 'Crew member'}
                      <Text style={styles.crewRole}>
                        {' '}
                        · {row.role === RunCrewRole.DRIVER ? 'Driver' : 'Conductor'}
                      </Text>
                      {!row.is_active ? <Text style={styles.inactive}> (inactive)</Text> : null}
                    </Text>
                    <Text style={styles.crewDates}>
                      {row.effective_from} → {row.effective_to ?? 'open ended'}
                    </Text>
                  </View>
                  <Pressable onPress={() => startCrewEdit(row)} hitSlop={6} style={styles.textBtn}>
                    <Ionicons name="create-outline" size={16} color={colors.primary[700]} />
                    <Text style={styles.textBtnLabel}>Edit</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setPendingCrewDelete(row)}
                    hitSlop={6}
                    style={styles.textBtn}
                  >
                    <Ionicons name="trash-outline" size={16} color={colors.status.danger} />
                    <Text style={[styles.textBtnLabel, { color: colors.status.danger }]}>
                      Remove
                    </Text>
                  </Pressable>
                </View>
              ))
            )}

            <View style={styles.divider} />
            <Text style={styles.crewFormTitle}>
              {crewEditing ? 'Edit roster entry' : 'Add crew member'}
            </Text>
            <Select
              label="Role"
              value={crewForm.role}
              onChange={(value) =>
                // The person picker is per-role: a driver id is meaningless on
                // the conductor list, so the selection cannot survive the swap.
                setCrewForm({ ...crewForm, role: value as RunCrewRole, user_id: '' })
              }
              options={[
                { value: RunCrewRole.DRIVER, label: 'Driver' },
                { value: RunCrewRole.CONDUCTOR, label: 'Conductor' },
              ]}
              error={crewErrors.role}
            />
            <Select
              label={crewForm.role === RunCrewRole.DRIVER ? 'Driver' : 'Conductor'}
              value={crewForm.user_id}
              onChange={(value) => setCrewForm({ ...crewForm, user_id: value })}
              options={crewPeople.map((person) => ({
                value: person.id,
                label: `${fullName(person)} — ${person.email}`,
              }))}
              placeholder="Select person"
              error={crewErrors.user_id}
            />
            <View style={styles.row}>
              <View style={styles.flex}>
                <Field
                  label="From (YYYY-MM-DD)"
                  value={crewForm.effective_from}
                  onChangeText={(text) => setCrewForm({ ...crewForm, effective_from: text })}
                  autoCapitalize="none"
                  error={crewErrors.effective_from}
                />
              </View>
              <View style={styles.flex}>
                <Field
                  label="To (optional)"
                  value={crewForm.effective_to}
                  onChangeText={(text) => setCrewForm({ ...crewForm, effective_to: text })}
                  placeholder="Open ended"
                  autoCapitalize="none"
                  error={crewErrors.effective_to}
                />
              </View>
            </View>
            <SwitchRow
              label="Active"
              value={crewForm.is_active}
              onChange={(value) => setCrewForm({ ...crewForm, is_active: value })}
            />
            <View style={styles.crewFormActions}>
              {crewEditing ? (
                <Button
                  label="Cancel edit"
                  variant="secondary"
                  onPress={resetCrewForm}
                  style={styles.flex}
                />
              ) : null}
              <Button
                label={crewEditing ? 'Save changes' : 'Roster'}
                onPress={() => void saveCrew()}
                busy={crewBusy}
                style={styles.flex}
              />
            </View>
          </>
        )}
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingCrewDelete)}
        title="Remove roster entry?"
        message={
          pendingCrewDelete
            ? `${pendingCrewDelete.user_name ?? 'This crew member'} will be taken off ${crewRun?.code ?? 'the run'}.`
            : ''
        }
        confirmLabel="Remove"
        danger
        busy={crewBusy}
        onConfirm={() => void removeCrew()}
        onCancel={() => setPendingCrewDelete(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', padding: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm },
  spacer: { flex: 1 },
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
    marginBottom: spacing.sm,
  },
  count: {
    color: colors.neutral[500],
    fontSize: 12,
    marginBottom: spacing.sm,
  },
  warn: {
    color: colors.status.warning,
    fontSize: typography.fontSizes.xs,
    marginTop: -spacing.xs,
    marginBottom: spacing.md,
  },
  runCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: colors.neutral[200],
    borderRadius: borderRadius.lg,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  runTop: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
  },
  runTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
  },
  defaultMark: {
    color: colors.neutral[400],
    fontWeight: '600',
    fontSize: typography.fontSizes.xs,
  },
  inactive: {
    color: colors.neutral[400],
    fontWeight: '500',
    fontSize: typography.fontSizes.xs,
  },
  runMeta: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  runActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.neutral[100],
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
  crewEmpty: {
    color: colors.neutral[500],
    fontSize: typography.fontSizes.sm,
    marginBottom: spacing.sm,
  },
  crewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.neutral[100],
  },
  crewName: {
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.neutral[900],
  },
  crewRole: {
    color: colors.neutral[500],
    fontWeight: '500',
  },
  crewDates: {
    fontSize: typography.fontSizes.xs,
    color: colors.neutral[500],
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.neutral[200],
    marginVertical: spacing.md,
  },
  crewFormTitle: {
    fontSize: typography.fontSizes.base,
    fontWeight: '700',
    color: colors.neutral[900],
    marginBottom: spacing.sm,
  },
  crewFormActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
});
