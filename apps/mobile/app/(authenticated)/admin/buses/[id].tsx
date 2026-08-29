import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { busCreateSchema, busUpdateSchema } from '@school-bus-tracking/validation';
import { Screen } from '../../../../src/components/Screen';
import { TextField } from '../../../../src/components/TextField';
import { Button } from '../../../../src/components/Button';
import { LoadingView } from '../../../../src/components/Feedback';
import { useToast } from '../../../../src/components/Toast';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useLoad } from '../../../../src/hooks/use-load';
import {
  AdminFormScreen,
  messageFromError,
  zodFieldErrors,
} from '../../../../src/features/admin/admin-shared';

export default function BusEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    registration_number: '',
    bus_number: '',
    capacity: '',
    is_active: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existing = useLoad(
    async () => (isNew ? null : ((await api.getBus(id)).data ?? null)),
    [id],
  );

  useEffect(() => {
    if (existing.data) {
      setForm({
        registration_number: existing.data.registration_number,
        bus_number: existing.data.bus_number ?? '',
        capacity: String(existing.data.capacity),
        is_active: existing.data.is_active,
      });
    }
  }, [existing.data]);

  const save = async (): Promise<void> => {
    setBanner(null);
    const payload = {
      registration_number: form.registration_number.trim().toUpperCase(),
      bus_number: form.bus_number.trim() || null,
      capacity: Number(form.capacity),
      is_active: form.is_active,
    };
    const parsed = (isNew ? busCreateSchema : busUpdateSchema).safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error);
      setErrors(fieldErrors);
      setBanner(Object.values(fieldErrors)[0] ?? 'Please correct the highlighted fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (isNew) {
        await api.createBus(parsed.data as never);
        toast.show('Bus added to the fleet.', 'success');
        router.back();
      } else {
        await api.updateBus(id, parsed.data as never);
        toast.show('Bus updated.', 'success');
        void existing.reload();
      }
    } catch (error) {
      setBanner(messageFromError(error, 'Could not save the bus.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {existing.loading && !isNew ? <LoadingView label="Loading bus…" /> : null}
      <AdminFormScreen
        onSave={() => void save()}
        busy={saving}
        banner={banner}
        saveLabel={isNew ? 'Add bus' : 'Save changes'}
      >
        <TextField
          label="Registration number"
          autoCapitalize="characters"
          value={form.registration_number}
          error={errors.registration_number}
          onChangeText={(v) => setForm({ ...form, registration_number: v })}
        />
        <TextField
          label="Bus number (display)"
          value={form.bus_number}
          error={errors.bus_number}
          onChangeText={(v) => setForm({ ...form, bus_number: v })}
        />
        <TextField
          label="Capacity"
          keyboardType="number-pad"
          value={form.capacity}
          error={errors.capacity}
          onChangeText={(v) => setForm({ ...form, capacity: v })}
        />
        <Button
          label={form.is_active ? 'Status: in fleet' : 'Status: deactivated'}
          variant="secondary"
          onPress={() => setForm({ ...form, is_active: !form.is_active })}
        />
      </AdminFormScreen>
    </Screen>
  );
}
