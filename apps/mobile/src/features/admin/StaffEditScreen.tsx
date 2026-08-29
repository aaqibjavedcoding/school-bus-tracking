import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { staffCreateSchema, staffUpdateSchema } from '@school-bus-tracking/validation';
import { Screen } from '../../components/Screen';
import { TextField } from '../../components/TextField';
import { Button } from '../../components/Button';
import { LoadingView } from '../../components/Feedback';
import { useToast } from '../../components/Toast';
import { getGlobalSession } from '../../auth/global-session';
import { AdminFormScreen, messageFromError, zodFieldErrors } from './admin-shared';
import { useStaffMember } from './admin-hooks';

/**
 * Driver / conductor create + edit (Task 23 §C). The role is pinned per
 * endpoint by the API (`/drivers` vs `/conductors`) — the app never sends a
 * role or tenant on these forms. Deactivation is an update (`is_active`),
 * deletion follows the existing endpoint behaviour.
 */
export const StaffEditScreen: React.FC<{ kind: 'driver' | 'conductor' }> = ({ kind }) => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    password: '',
    is_active: true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const existing = useStaffMember(kind, isNew ? '' : id);

  useEffect(() => {
    if (!isNew && existing.data) {
      setForm({
        first_name: existing.data.first_name,
        last_name: existing.data.last_name,
        email: existing.data.email,
        phone: existing.data.phone ?? '',
        password: '',
        is_active: existing.data.is_active,
      });
    }
  }, [existing.data, isNew]);

  const save = async (): Promise<void> => {
    setBanner(null);
    const payload: Record<string, unknown> = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim() || null,
      is_active: form.is_active,
    };
    if (form.password.trim() || isNew) {
      payload.password = form.password.trim();
    }
    const parsed = (isNew ? staffCreateSchema : staffUpdateSchema).safeParse(payload);
    if (!parsed.success) {
      const fieldErrors = zodFieldErrors(parsed.error);
      setErrors(fieldErrors);
      setBanner(Object.values(fieldErrors)[0] ?? 'Please correct the highlighted fields.');
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      const call =
        kind === 'driver'
          ? isNew
            ? api.createDriver(parsed.data as never)
            : api.updateDriver(id, parsed.data as never)
          : isNew
            ? api.createConductor(parsed.data as never)
            : api.updateConductor(id, parsed.data as never);
      await call;
      toast.show(isNew ? 'Account created.' : 'Account updated.', 'success');
      if (isNew) {
        router.back();
      } else {
        void existing.reload();
      }
    } catch (error) {
      setBanner(messageFromError(error, 'Could not save the account.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {existing.loading && !isNew ? <LoadingView label="Loading account…" /> : null}
      <AdminFormScreen
        onSave={() => void save()}
        busy={saving}
        banner={banner}
        saveLabel={isNew ? `Create ${kind}` : 'Save changes'}
      >
        <TextField
          label="First name"
          value={form.first_name}
          error={errors.first_name}
          onChangeText={(v) => setForm({ ...form, first_name: v })}
        />
        <TextField
          label="Last name"
          value={form.last_name}
          error={errors.last_name}
          onChangeText={(v) => setForm({ ...form, last_name: v })}
        />
        <TextField
          label="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={form.email}
          error={errors.email}
          onChangeText={(v) => setForm({ ...form, email: v })}
        />
        <TextField
          label="Phone"
          keyboardType="phone-pad"
          value={form.phone}
          onChangeText={(v) => setForm({ ...form, phone: v })}
        />
        <TextField
          label={isNew ? 'Temporary password' : 'New password (optional)'}
          secureTextEntry
          value={form.password}
          error={errors.password}
          hint={
            isNew
              ? 'Set once here; the crew member changes it later.'
              : 'Leave empty to keep the current password.'
          }
          onChangeText={(v) => setForm({ ...form, password: v })}
        />
        <Button
          label={form.is_active ? 'Status: active' : 'Status: inactive (cannot be dispatched)'}
          variant="secondary"
          onPress={() => setForm({ ...form, is_active: !form.is_active })}
        />
      </AdminFormScreen>
    </Screen>
  );
};
