import React, { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { parentCreateSchema } from '@school-bus-tracking/validation';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { TextField } from '../../../../src/components/TextField';
import { Button } from '../../../../src/components/Button';
import { ListRow } from '../../../../src/components/ListRow';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { EmptyState, LoadingView } from '../../../../src/components/Feedback';
import { useToast } from '../../../../src/components/Toast';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useLoad } from '../../../../src/hooks/use-load';
import {
  AdminFormScreen,
  messageFromError,
  zodFieldErrors,
} from '../../../../src/features/admin/admin-shared';
import { useParentChildren } from '../../../../src/features/admin/admin-hooks';

/**
 * Parent account edit + the guardian relationships the account has.
 * Creating/linking parents here uses the existing `/parents` endpoints only.
 */
export default function ParentEditScreen() {
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

  const existing = useLoad(async () => {
    if (isNew) return null;
    return (await api.getParent(id)).data ?? null;
  }, [id]);

  const children = useParentChildren(isNew ? null : id);

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
    if (form.password.trim()) {
      payload.password = form.password.trim();
    }
    if (isNew) {
      const parsed = parentCreateSchema.safeParse(payload);
      if (!parsed.success) {
        setErrors(zodFieldErrors(parsed.error));
        return;
      }
      setErrors({});
    }
    setSaving(true);
    try {
      if (isNew) {
        await api.createParent(payload as never);
        toast.show('Parent account created.', 'success');
        router.back();
      } else {
        await api.updateParent(id, payload as never);
        toast.show('Parent updated.', 'success');
        void existing.reload();
      }
    } catch (error) {
      setBanner(messageFromError(error, 'Could not save the parent account.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {existing.loading && !isNew ? <LoadingView label="Loading parent…" /> : null}
      <AdminFormScreen
        onSave={() => void save()}
        busy={saving}
        banner={banner}
        saveLabel={isNew ? 'Create parent' : 'Save changes'}
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
              ? 'Shared with the parent in person; they can change it later.'
              : 'Leave empty to keep the current password.'
          }
          onChangeText={(v) => setForm({ ...form, password: v })}
        />
        <Button
          label={form.is_active ? 'Status: active' : 'Status: inactive'}
          variant="secondary"
          onPress={() => setForm({ ...form, is_active: !form.is_active })}
        />
      </AdminFormScreen>

      {!isNew ? (
        <Card
          title="Children"
          description="Guardian links maintained from the student screens; shown here for context."
        >
          {children.loading ? <LoadingView label="Loading links…" /> : null}
          {(children.data ?? []).length === 0 && !children.loading ? (
            <EmptyState
              title="No children linked"
              message="Open a student and use “Parents / guardians” to link them."
              icon="🧒"
            />
          ) : null}
          {(children.data ?? []).map((link) => (
            <ListRow
              key={link.id}
              title={`Student ${link.student_id.slice(0, 8)}`}
              subtitle={`${link.relationship}${link.is_primary ? ' · primary' : ''}`}
              right={
                <StatusBadge
                  tone={link.can_pick_up ? 'success' : 'neutral'}
                  label={link.can_pick_up ? 'PICK-UP OK' : 'NO PICK-UP'}
                  compact
                />
              }
            />
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
