import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { spacing } from '@school-bus-tracking/design-tokens';
import { assignmentCreateSchema } from '@school-bus-tracking/validation';
import { RouteAssignmentRole } from '@school-bus-tracking/shared-types';
import { Screen } from '../../../src/components/Screen';
import { Card } from '../../../src/components/Card';
import { Button } from '../../../src/components/Button';
import { TextField } from '../../../src/components/TextField';
import { Select } from '../../../src/components/Select';
import { ListRow } from '../../../src/components/ListRow';
import { StatusBadge } from '../../../src/components/StatusBadge';
import { ErrorBanner, LoadingView } from '../../../src/components/Feedback';
import { RefreshList } from '../../../src/components/RefreshList';
import { useToast } from '../../../src/components/Toast';
import { confirmAction } from '../../../src/components/Confirm';
import { getGlobalSession } from '../../../src/auth/global-session';
import { useLoad } from '../../../src/hooks/use-load';
import { messageFromError, zodFieldErrors } from '../../../src/features/admin/admin-shared';
import { useAssignmentRows } from '../../../src/features/admin/admin-hooks';
import { formatDateLabel } from '../../../src/utils/format';
import { todayUtcDate } from '../../../src/utils/format';

/**
 * Route ↔ bus ↔ crew rosters (Task 23 §C). One row per person+role; the API
 * checks the effective window for double-bookings and answers 409 — the form
 * surfaces that verbatim. A trip can only be dispatched from an ACTIVE
 * assignment covering the trip date, exactly as the web console enforces.
 */
export default function AdminAssignmentsScreen() {
  const api = getGlobalSession().apiClient;
  const toast = useToast();
  const rows = useAssignmentRows();

  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    role: RouteAssignmentRole.DRIVER as RouteAssignmentRole,
    route_id: null as string | null,
    bus_id: null as string | null,
    user_id: null as string | null,
    effective_from: todayUtcDate(),
    effective_to: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const pickers = useLoad(async () => {
    const [routes, buses, drivers, conductors] = await Promise.all([
      api.listRoutes({ limit: 100 }),
      api.listBuses({ limit: 100 }),
      api.listDrivers({ limit: 100 }),
      api.listConductors({ limit: 100 }),
    ]);
    return {
      routes: routes.data?.items ?? [],
      buses: buses.data?.items ?? [],
      drivers: drivers.data?.items ?? [],
      conductors: conductors.data?.items ?? [],
    };
  }, []);

  const people =
    form.role === RouteAssignmentRole.DRIVER
      ? (pickers.data?.drivers ?? [])
      : (pickers.data?.conductors ?? []);
  const peopleOptions = useMemo(
    () =>
      people.map((p) => ({
        id: p.id,
        label: `${p.first_name} ${p.last_name}`,
        hint: p.is_active ? undefined : 'inactive — refused by the API',
      })),
    [people],
  );

  const create = async (): Promise<void> => {
    setBanner(null);
    const payload = {
      role: form.role,
      route_id: form.route_id,
      bus_id: form.bus_id,
      user_id: form.user_id,
      effective_from: form.effective_from,
      ...(form.effective_to.trim() ? { effective_to: form.effective_to.trim() } : {}),
      is_active: true,
    };
    const parsed = assignmentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error as never);
      setErrors(fieldErrors);
      setBanner(Object.values(fieldErrors)[0] ?? 'Check the roster row.');
      return;
    }
    setSaving(true);
    try {
      await api.createAssignment(parsed.data as never);
      toast.show('Assignment created.', 'success');
      setCreating(false);
      setForm({ ...form, user_id: null });
      void rows.refresh();
    } catch (error) {
      // 409 conflict (crew/bus double-booked) and inactive-resource refusals
      // come back as the API's own messages — shown unchanged.
      setBanner(messageFromError(error, 'Could not create the assignment.'));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (assignmentId: string, nextActive: boolean): Promise<void> => {
    const ok = await confirmAction(
      nextActive ? 'Re-activate this roster row?' : 'Deactivate this roster row?',
      nextActive
        ? 'Trips can be dispatched from it again (subject to the date window).'
        : 'No new trips can be dispatched from it; existing trips are untouched.',
      { confirmLabel: nextActive ? 'Activate' : 'Deactivate', destructive: !nextActive },
    );
    if (!ok) {
      return;
    }
    try {
      await api.updateAssignment(assignmentId, { is_active: nextActive });
      toast.show('Assignment updated.', 'success');
      void rows.refresh();
    } catch (error) {
      toast.show(messageFromError(error, 'Could not update the assignment.'), 'danger');
    }
  };

  if (rows.loading && !rows.rows.length) {
    return (
      <Screen scroll={false}>
        <LoadingView label="Loading rosters…" />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Button
        label={creating ? 'Close form' : 'New assignment'}
        variant={creating ? 'secondary' : 'primary'}
        onPress={() => setCreating((c) => !c)}
        style={styles.toggle}
        testID="assignment-toggle-create"
      />
      {creating ? (
        <Card
          title="Dispatch roster row"
          description="One person, one role, one bus, for a date window."
        >
          {banner ? <ErrorBanner message={banner} /> : null}
          <Select
            label="Role"
            options={[
              { id: RouteAssignmentRole.DRIVER, label: 'Driver' },
              { id: RouteAssignmentRole.CONDUCTOR, label: 'Conductor' },
            ]}
            value={form.role}
            searchable={false}
            onPick={(value) =>
              setForm({
                ...form,
                role: (value ?? RouteAssignmentRole.DRIVER) as RouteAssignmentRole,
                user_id: null,
              })
            }
          />
          <Select
            label="Route"
            options={(pickers.data?.routes ?? []).map((r) => ({
              id: r.id,
              label: r.name,
              hint: r.code,
            }))}
            value={form.route_id}
            onPick={(route_id) => setForm({ ...form, route_id })}
            error={errors.route_id}
          />
          <Select
            label="Bus"
            options={(pickers.data?.buses ?? []).map((b) => ({
              id: b.id,
              label: b.bus_number ? `Bus ${b.bus_number}` : b.registration_number,
              hint: b.registration_number,
            }))}
            value={form.bus_id}
            onPick={(bus_id) => setForm({ ...form, bus_id })}
            error={errors.bus_id}
          />
          <Select
            label={form.role === RouteAssignmentRole.DRIVER ? 'Driver' : 'Conductor'}
            options={peopleOptions}
            value={form.user_id}
            onPick={(user_id) => setForm({ ...form, user_id })}
            error={errors.user_id}
          />
          <TextField
            label="Effective from"
            placeholder="YYYY-MM-DD"
            value={form.effective_from}
            error={errors.effective_from}
            onChangeText={(v) => setForm({ ...form, effective_from: v })}
          />
          <TextField
            label="Effective to (empty = open-ended)"
            placeholder="YYYY-MM-DD"
            value={form.effective_to}
            error={errors.effective_to}
            onChangeText={(v) => setForm({ ...form, effective_to: v })}
          />
          <Button
            label={saving ? 'Saving…' : 'Create assignment'}
            busy={saving}
            onPress={() => void create()}
            fullWidth
          />
        </Card>
      ) : null}

      <RefreshList
        data={rows.rows.map((row) => ({ ...row, id: row.assignment.id }))}
        refreshing={rows.refreshing}
        onRefresh={() => void rows.refresh()}
        emptyTitle="No assignments"
        emptyMessage="Assign a driver or conductor to a route + bus to enable dispatch."
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <ListRow
            title={`${item.personLabel} · ${item.assignment.role === RouteAssignmentRole.DRIVER ? 'Driver' : 'Conductor'}`}
            subtitle={`${item.routeLabel} · ${item.busLabel}`}
            meta={`Active ${formatDateLabel(item.assignment.effective_from)} → ${
              item.assignment.effective_to
                ? formatDateLabel(item.assignment.effective_to)
                : 'open-ended'
            }`}
            right={
              <View style={styles.rowRight}>
                <StatusBadge
                  tone={item.assignment.is_active ? 'success' : 'neutral'}
                  label={item.assignment.is_active ? 'ACTIVE' : 'INACTIVE'}
                  compact
                />
                <Button
                  label={item.assignment.is_active ? 'Deactivate' : 'Activate'}
                  small
                  variant="ghost"
                  onPress={() => void toggleActive(item.assignment.id, !item.assignment.is_active)}
                />
              </View>
            }
          />
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  toggle: {
    marginBottom: spacing.md,
  },
  rowRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
});
