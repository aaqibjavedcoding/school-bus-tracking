import React, { useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { tripCreateSchema } from '@school-bus-tracking/validation';
import { Screen } from '../../../../src/components/Screen';
import { TextField } from '../../../../src/components/TextField';
import { Select } from '../../../../src/components/Select';
import { LoadingView } from '../../../../src/components/Feedback';
import { useToast } from '../../../../src/components/Toast';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useLoad } from '../../../../src/hooks/use-load';
import {
  AdminFormScreen,
  messageFromError,
  zodFieldErrors,
} from '../../../../src/features/admin/admin-shared';
import { tomorrowFrom } from '../../../../src/features/admin/admin-hooks';

/**
 * Schedule / dispatch a trip from an ACTIVE assignment window — the exact
 * contract of POST /trips. The API derives school + tenant from the caller;
 * conflicts (bus/crew double-booking) return 409 with the server message.
 */
export default function NewTripScreen() {
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    route_assignment_id: null as string | null,
    trip_date: new Date().toISOString().slice(0, 10),
    scheduled_start_at: '',
    scheduled_end_at: '',
    direction: 'MORNING' as 'MORNING' | 'AFTERNOON',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = useLoad(async () => {
    const [assignments, routes] = await Promise.all([
      api.listAssignments({ limit: 200 }),
      api.listRoutes({ limit: 100 }),
    ]);
    const routeNames = new Map((routes.data?.items ?? []).map((r) => [r.id, r.name]));
    return {
      assignments: (assignments.data?.items ?? []).filter((assignment) => assignment.is_active),
      routeNames,
    };
  }, []);

  const assignmentOptions = useMemo(
    () =>
      (options.data?.assignments ?? []).map((assignment) => ({
        id: assignment.id,
        label:
          (options.data?.routeNames.get(assignment.route_id) ?? 'Route') +
          ' · ' +
          (assignment.role === 'DRIVER' ? 'Driver' : 'Conductor'),
        hint: `Window ${assignment.effective_from} -> ${assignment.effective_to ?? 'open'}`,
      })),
    [options.data],
  );

  const save = async (): Promise<void> => {
    setBanner(null);
    const toIso = (date: string, time: string): string | null => {
      if (!time.trim()) {
        return null;
      }
      const [h, m] = time.split(':');
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCHours(Number(h), Number(m), 0, 0);
      return d.toISOString();
    };
    const start = toIso(form.trip_date, form.scheduled_start_at);
    const end = toIso(form.trip_date, form.scheduled_end_at);
    const payload = {
      route_assignment_id: form.route_assignment_id,
      trip_date: form.trip_date,
      scheduled_start_at: start,
      ...(end ? { scheduled_end_at: end } : {}),
      direction: form.direction,
    };
    const parsed = tripCreateSchema.safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error as never);
      setErrors(fieldErrors);
      setBanner(Object.values(fieldErrors)[0] ?? 'Check the schedule fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const created = await api.createTrip(parsed.data as never);
      toast.show('Trip scheduled.', 'success');
      if (created.data?.id) {
        router.replace(`/admin/trips/${created.data.id}` as never);
      } else {
        router.back();
      }
    } catch (error) {
      setBanner(messageFromError(error, 'Could not schedule the trip.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {options.loading ? <LoadingView label="Loading rosters..." /> : null}
      <AdminFormScreen
        onSave={() => void save()}
        busy={saving}
        banner={banner}
        saveLabel="Schedule trip"
      >
        <Select
          label="Active assignment"
          options={assignmentOptions}
          value={form.route_assignment_id}
          placeholder={
            assignmentOptions.length === 0
              ? 'No active assignments - create one first'
              : 'Pick the route/bus/crew roster row'
          }
          onPick={(route_assignment_id) => setForm({ ...form, route_assignment_id })}
          error={errors.route_assignment_id}
        />
        <TextField
          label="Trip date"
          placeholder="YYYY-MM-DD"
          value={form.trip_date}
          error={errors.trip_date}
          onChangeText={(v) => setForm({ ...form, trip_date: v })}
        />
        <TextField
          label="Scheduled start (UTC)"
          placeholder="06:30"
          value={form.scheduled_start_at}
          error={errors.scheduled_start_at}
          onChangeText={(v) => setForm({ ...form, scheduled_start_at: v })}
        />
        <TextField
          label="Scheduled end (UTC)"
          placeholder="07:15"
          value={form.scheduled_end_at}
          error={errors.scheduled_end_at}
          onChangeText={(v) => setForm({ ...form, scheduled_end_at: v })}
        />
        <Select
          label="Direction"
          options={[
            { id: 'MORNING', label: 'Morning pickup' },
            { id: 'AFTERNOON', label: 'Afternoon drop' },
          ]}
          value={form.direction}
          searchable={false}
          onPick={(direction) =>
            setForm({ ...form, direction: (direction as 'MORNING' | 'AFTERNOON') ?? 'MORNING' })
          }
        />
        <Text style={styles.hint}>Tomorrow would be {tomorrowFrom(form.trip_date)}.</Text>
      </AdminFormScreen>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 12,
    color: colors.neutral[600],
    marginTop: spacing.xs,
  },
});
