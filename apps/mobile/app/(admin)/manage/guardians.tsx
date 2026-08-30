import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ParentCreateRequest,
  ParentResponse,
  ParentUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { parentCreateSchema, parentUpdateSchema } from '@school-bus-tracking/validation';
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
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Fab,
  Field,
  FormSheet,
  ListCard,
  LoadingView,
  Pagination,
  Screen,
  SearchBar,
  SwitchRow,
  useToast,
} from '../../../src/components';

const EMPTY = {
  first_name: '',
  last_name: '',
  email: '',
  password: '',
  phone: '',
  is_active: true,
};

/**
 * School-admin guardian (parent account) management — CRUD parity with the
 * web parent management. Children are linked to a guardian from the student
 * detail screen (Manage → Students → guardians).
 */
export default function ManageGuardiansScreen() {
  const toast = useToast();
  const list = usePagedResource<ParentResponse>(
    async (page, search) => unwrapEnvelope(await apiClient.listParents({ page, limit: 20, search })),
    [],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ParentResponse | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ParentResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (parent: ParentResponse) => {
    setEditing(parent);
    setForm({
      first_name: parent.first_name,
      last_name: parent.last_name,
      email: parent.email,
      password: '',
      phone: parent.phone ?? '',
      is_active: parent.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    if (editing) {
      const body: ParentUpdateRequest = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        phone: emptyToNull(form.phone),
        is_active: form.is_active,
        ...(form.password ? { password: form.password } : {}),
      };
      const parsed = parentUpdateSchema.safeParse(body);
      if (!parsed.success) {
        setFieldErrors(fieldErrorsFromZod(parsed.error));
        return;
      }
      setBusy(true);
      try {
        unwrapEnvelope(await apiClient.updateParent(editing.id, parsed.data));
        toast.push('Guardian updated.', 'success');
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

    const body: ParentCreateRequest = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      password: form.password,
      phone: emptyToNull(form.phone),
      is_active: form.is_active,
    };
    const parsed = parentCreateSchema.safeParse(body);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      unwrapEnvelope(await apiClient.createParent(parsed.data));
      toast.push('Guardian created.', 'success');
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
      await apiClient.deleteParent(pendingDelete.id);
      toast.push('Guardian removed.', 'success');
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
      <Screen refresh={() => void list.reload()} refreshing={list.loading}>
        <SearchBar value={list.search} onChangeText={list.setSearch} placeholder="Search name or email…" />

        {list.loading && list.items.length === 0 ? (
          <LoadingView label="Loading guardians…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={list.search ? 'No matches' : 'No guardians yet'}
            description={
              list.search
                ? `Nothing matched “${list.search}”.`
                : 'Create parent accounts, then link them to students from the student detail screen.'
            }
          />
        ) : (
          <>
            <Text style={styles.count}>{list.meta.total} guardians</Text>
            {list.items.map((parent) => (
              <ListCard
                key={parent.id}
                title={fullName(parent)}
                subtitle={parent.email}
                meta={parent.phone}
                right={
                  <Badge
                    label={parent.is_active ? 'Active' : 'Inactive'}
                    tone={parent.is_active ? 'success' : 'neutral'}
                  />
                }
                onEdit={() => startEdit(parent)}
                onDelete={() => setPendingDelete(parent)}
              />
            ))}
            <Pagination meta={list.meta} onPage={list.setPage} />
          </>
        )}
      </Screen>

      <Fab onPress={startCreate} label="Add guardian" />

      <FormSheet
        open={open}
        title={editing ? 'Edit guardian' : 'Add guardian'}
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
        title="Delete guardian?"
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
