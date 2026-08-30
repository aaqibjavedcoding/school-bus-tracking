import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  StudentGender,
  type RouteListResponse,
  type RouteResponse,
  type StopListResponse,
  type StopResponse,
  type StudentCreateRequest,
  type StudentResponse,
  type StudentUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { studentCreateSchema, studentUpdateSchema } from '@school-bus-tracking/validation';
import { colors, spacing } from '@school-bus-tracking/design-tokens';
import { apiClient } from '../../../src/services/api';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../src/lib/errors';
import { stopCode } from '../../../src/lib/format';
import { useLoad } from '../../../src/hooks/useLoad';
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
  Select,
  SwitchRow,
  useToast,
} from '../../../src/components';

const EMPTY = {
  admission_number: '',
  first_name: '',
  last_name: '',
  date_of_birth: '',
  gender: '',
  grade_level: '',
  home_stop_id: '',
  emergency_contact_name: '',
  emergency_contact_phone: '',
  medical_notes: '',
  is_active: true,
};

type FormState = typeof EMPTY;

function toPayload(form: FormState): StudentCreateRequest {
  return {
    admission_number: form.admission_number.trim(),
    first_name: form.first_name.trim(),
    last_name: form.last_name.trim(),
    date_of_birth: emptyToNull(form.date_of_birth),
    gender: form.gender ? (form.gender as StudentGender) : null,
    grade_level: emptyToNull(form.grade_level),
    home_stop_id: emptyToNull(form.home_stop_id),
    emergency_contact_name: emptyToNull(form.emergency_contact_name),
    emergency_contact_phone: emptyToNull(form.emergency_contact_phone),
    medical_notes: emptyToNull(form.medical_notes),
    is_active: form.is_active,
  };
}

/** School-admin student roster — CRUD parity with the web Students page. */
export default function ManageStudentsScreen() {
  const router = useRouter();
  const toast = useToast();

  const lookups = useLoad(async (): Promise<{ stops: StopResponse[]; routes: RouteResponse[] }> => {
    const [stops, routes] = await Promise.all([
      apiClient.listStops({ page: 1, limit: 100 }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
    ]);
    return {
      stops: unwrapEnvelope<StopListResponse>(stops).items,
      routes: unwrapEnvelope<RouteListResponse>(routes).items,
    };
  }, []);

  const list = usePagedResource<StudentResponse>(
    async (page, search) => unwrapEnvelope(await apiClient.listStudents({ page, limit: 20, search })),
    [],
  );

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StudentResponse | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StudentResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setFieldErrors({});
    setOpen(true);
  };

  const startEdit = (student: StudentResponse) => {
    setEditing(student);
    setForm({
      admission_number: student.admission_number,
      first_name: student.first_name,
      last_name: student.last_name,
      date_of_birth: student.date_of_birth ?? '',
      gender: student.gender ?? '',
      grade_level: student.grade_level ?? '',
      home_stop_id: student.home_stop_id ?? '',
      emergency_contact_name: student.emergency_contact_name ?? '',
      emergency_contact_phone: student.emergency_contact_phone ?? '',
      medical_notes: student.medical_notes ?? '',
      is_active: student.is_active,
    });
    setFieldErrors({});
    setOpen(true);
  };

  const save = async () => {
    const payload = toPayload(form);
    const parsed = editing
      ? studentUpdateSchema.safeParse(payload)
      : studentCreateSchema.safeParse(payload);
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        unwrapEnvelope(await apiClient.updateStudent(editing.id, parsed.data as StudentUpdateRequest));
        toast.push('Student updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createStudent(parsed.data as StudentCreateRequest));
        toast.push('Student added.', 'success');
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
      await apiClient.deleteStudent(pendingDelete.id);
      toast.push('Student removed.', 'success');
      setPendingDelete(null);
      await list.reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const stopLabel = (stop: StopResponse): string => {
    const route = lookups.data?.routes.find((entry) => entry.id === stop.route_id);
    return route ? `${stopCode(route.code, stop.sequence_number)} — ${stop.name}` : stop.name;
  };

  const stopOptions = [
    { value: '', label: 'No home stop' },
    ...(lookups.data?.stops ?? []).map((stop) => ({ value: stop.id, label: stopLabel(stop) })),
  ];

  return (
    <View style={styles.flex}>
      <Screen refresh={() => void list.reload()} refreshing={list.loading}>
        <SearchBar
          value={list.search}
          onChangeText={list.setSearch}
          placeholder="Search name or admission number…"
        />

        {list.loading && list.items.length === 0 ? (
          <LoadingView label="Loading students…" />
        ) : list.error ? (
          <ErrorState message={list.error} onRetry={() => void list.reload()} />
        ) : list.items.length === 0 ? (
          <EmptyState
            title={list.search ? 'No students match' : 'No students yet'}
            description={
              list.search
                ? `Nothing matched “${list.search}”.`
                : 'Add students to build your roster.'
            }
          />
        ) : (
          <>
            <Text style={styles.count}>{list.meta.total} students</Text>
            {list.items.map((student) => (
              <ListCard
                key={student.id}
                title={`${student.first_name} ${student.last_name}`}
                subtitle={student.home_stop_name ? `Stop: ${student.home_stop_name}` : null}
                meta={`${student.admission_number}${student.grade_level ? ` · Grade ${student.grade_level}` : ''}`}
                right={
                  <Badge
                    label={student.is_active ? 'Active' : 'Inactive'}
                    tone={student.is_active ? 'success' : 'neutral'}
                  />
                }
                onPress={() => router.push(`/manage/students/${student.id}`)}
                onEdit={() => startEdit(student)}
                onDelete={() => setPendingDelete(student)}
              />
            ))}
            <Pagination meta={list.meta} onPage={list.setPage} />
          </>
        )}
      </Screen>

      <Fab onPress={startCreate} label="Add student" />

      <FormSheet
        open={open}
        title={editing ? 'Edit student' : 'Add student'}
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button label="Cancel" variant="secondary" onPress={() => setOpen(false)} style={styles.flex} />
            <Button label="Save" onPress={() => void save()} busy={busy} style={styles.flex} />
          </>
        }
      >
        <Field
          label="Admission number"
          value={form.admission_number}
          onChangeText={(text) => setForm({ ...form, admission_number: text })}
          autoCapitalize="characters"
          error={fieldErrors.admission_number}
        />
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="First name"
              value={form.first_name}
              onChangeText={(text) => setForm({ ...form, first_name: text })}
              autoCapitalize="words"
              error={fieldErrors.first_name}
            />
          </View>
          <View style={styles.flex}>
            <Field
              label="Last name"
              value={form.last_name}
              onChangeText={(text) => setForm({ ...form, last_name: text })}
              autoCapitalize="words"
              error={fieldErrors.last_name}
            />
          </View>
        </View>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Field
              label="Grade"
              value={form.grade_level}
              onChangeText={(text) => setForm({ ...form, grade_level: text })}
              error={fieldErrors.grade_level}
            />
          </View>
          <View style={styles.flex}>
            <Field
              label="Date of birth"
              value={form.date_of_birth}
              onChangeText={(text) => setForm({ ...form, date_of_birth: text })}
              placeholder="YYYY-MM-DD"
              autoCapitalize="none"
              error={fieldErrors.date_of_birth}
            />
          </View>
        </View>
        <Select
          label="Gender"
          value={form.gender}
          onChange={(value) => setForm({ ...form, gender: value })}
          options={[
            { value: '', label: 'Not specified' },
            { value: StudentGender.MALE, label: 'Male' },
            { value: StudentGender.FEMALE, label: 'Female' },
            { value: StudentGender.OTHER, label: 'Other' },
          ]}
          error={fieldErrors.gender}
        />
        <Select
          label="Home stop"
          value={form.home_stop_id}
          onChange={(value) => setForm({ ...form, home_stop_id: value })}
          options={stopOptions}
          placeholder="No home stop"
          error={fieldErrors.home_stop_id}
        />
        <Field
          label="Emergency contact name"
          value={form.emergency_contact_name}
          onChangeText={(text) => setForm({ ...form, emergency_contact_name: text })}
          autoCapitalize="words"
          error={fieldErrors.emergency_contact_name}
        />
        <Field
          label="Emergency contact phone"
          value={form.emergency_contact_phone}
          onChangeText={(text) => setForm({ ...form, emergency_contact_phone: text })}
          keyboardType="phone-pad"
          error={fieldErrors.emergency_contact_phone}
        />
        <Field
          label="Medical notes"
          value={form.medical_notes}
          onChangeText={(text) => setForm({ ...form, medical_notes: text })}
          multiline
          autoCapitalize="sentences"
          style={styles.textArea}
          error={fieldErrors.medical_notes}
        />
        <SwitchRow
          label="Active"
          value={form.is_active}
          onChange={(value) => setForm({ ...form, is_active: value })}
        />
      </FormSheet>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete student?"
        message={
          pendingDelete
            ? `${pendingDelete.first_name} ${pendingDelete.last_name} will be removed from the roster.`
            : ''
        }
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
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
});
