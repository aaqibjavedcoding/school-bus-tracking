import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { studentCreateSchema, studentUpdateSchema } from '@school-bus-tracking/validation';
import { Screen } from '../../../../src/components/Screen';
import { Card } from '../../../../src/components/Card';
import { TextField } from '../../../../src/components/TextField';
import { Select } from '../../../../src/components/Select';
import { Button } from '../../../../src/components/Button';
import { ListRow } from '../../../../src/components/ListRow';
import { StatusBadge } from '../../../../src/components/StatusBadge';
import { EmptyState, LoadingView } from '../../../../src/components/Feedback';
import { useToast } from '../../../../src/components/Toast';
import { confirmAction } from '../../../../src/components/Confirm';
import { getGlobalSession } from '../../../../src/auth/global-session';
import { useLoad } from '../../../../src/hooks/use-load';
import {
  AdminFormScreen,
  messageFromError,
  zodFieldErrors,
} from '../../../../src/features/admin/admin-shared';
import { useGuardians, useStudent } from '../../../../src/features/admin/admin-hooks';

type StudentForm = {
  admission_number: string;
  first_name: string;
  last_name: string;
  date_of_birth: string;
  grade_level: string;
  home_stop_id: string | null;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  is_active: boolean;
};

const EMPTY_FORM: StudentForm = {
  admission_number: '',
  first_name: '',
  last_name: '',
  date_of_birth: '',
  grade_level: '',
  home_stop_id: null,
  emergency_contact_name: '',
  emergency_contact_phone: '',
  is_active: true,
};

/**
 * Student create/edit + home-stop assignment + guardian linking — all through
 * the existing `/students` endpoints. `school_id` is never sent; the API owns
 * the tenant.
 */
export default function StudentEditScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const api = getGlobalSession().apiClient;
  const router = useRouter();
  const toast = useToast();

  const existing = useStudent(isNew ? '' : id);
  const [form, setForm] = useState<StudentForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const options = useLoad(async () => {
    const [stops, routes, parents] = await Promise.all([
      api.listStops({ limit: 200 }),
      api.listRoutes({ limit: 100 }),
      api.listParents({ limit: 200 }),
    ]);
    const routeNames = new Map((routes.data?.items ?? []).map((r) => [r.id, r.name]));
    return {
      stops: stops.data?.items ?? [],
      stopOptions: (stops.data?.items ?? []).map((stop) => ({
        id: stop.id,
        label: stop.name,
        hint: routeNames.get(stop.route_id) ? `Route: ${routeNames.get(stop.route_id)}` : undefined,
      })),
      parentOptions: (parents.data?.items ?? []).map((parent) => ({
        id: parent.id,
        label: `${parent.first_name} ${parent.last_name}`,
        hint: parent.email,
      })),
    };
  }, []);

  useEffect(() => {
    if (!isNew && existing.data) {
      const student = existing.data;
      setForm({
        admission_number: student.admission_number,
        first_name: student.first_name,
        last_name: student.last_name,
        date_of_birth: student.date_of_birth ?? '',
        grade_level: student.grade_level ?? '',
        home_stop_id: student.home_stop_id,
        emergency_contact_name: student.emergency_contact_name ?? '',
        emergency_contact_phone: student.emergency_contact_phone ?? '',
        is_active: student.is_active,
      });
    }
  }, [existing.data, isNew]);

  const guardians = useGuardians(isNew ? null : id);

  const save = async (): Promise<void> => {
    setBanner(null);
    const payload = {
      admission_number: form.admission_number.trim(),
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      ...(form.date_of_birth.trim() ? { date_of_birth: form.date_of_birth.trim() } : {}),
      ...(form.grade_level.trim() ? { grade_level: form.grade_level.trim() } : {}),
      home_stop_id: form.home_stop_id,
      ...(form.emergency_contact_name.trim()
        ? { emergency_contact_name: form.emergency_contact_name.trim() }
        : {}),
      ...(form.emergency_contact_phone.trim()
        ? { emergency_contact_phone: form.emergency_contact_phone.trim() }
        : {}),
      is_active: form.is_active,
    };
    const parsed = (isNew ? studentCreateSchema : studentUpdateSchema).safeParse(payload);
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
        await api.createStudent(parsed.data as never);
        toast.show('Student created.', 'success');
        router.back();
      } else {
        await api.updateStudent(id, parsed.data as never);
        toast.show('Student updated.', 'success');
        void existing.reload();
      }
    } catch (error) {
      setBanner(messageFromError(error, 'Could not save the student.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      {existing.loading && !isNew ? <LoadingView label="Loading student…" /> : null}
      <AdminFormScreen
        onSave={() => void save()}
        busy={saving}
        banner={banner}
        saveLabel={isNew ? 'Create student' : 'Save changes'}
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
          label="Admission number"
          value={form.admission_number}
          error={errors.admission_number}
          autoCapitalize="none"
          onChangeText={(v) => setForm({ ...form, admission_number: v })}
        />
        <TextField
          label="Grade level"
          value={form.grade_level}
          error={errors.grade_level}
          onChangeText={(v) => setForm({ ...form, grade_level: v })}
        />
        <TextField
          label="Date of birth"
          placeholder="YYYY-MM-DD"
          value={form.date_of_birth}
          error={errors.date_of_birth}
          autoCapitalize="none"
          onChangeText={(v) => setForm({ ...form, date_of_birth: v })}
        />
        <Select
          label="Home stop"
          options={options.data?.stopOptions ?? []}
          value={form.home_stop_id}
          placeholder="None / clear"
          onPick={(home_stop_id) => setForm({ ...form, home_stop_id })}
        />
        <TextField
          label="Emergency contact name"
          value={form.emergency_contact_name}
          onChangeText={(v) => setForm({ ...form, emergency_contact_name: v })}
        />
        <TextField
          label="Emergency contact phone"
          keyboardType="phone-pad"
          value={form.emergency_contact_phone}
          onChangeText={(v) => setForm({ ...form, emergency_contact_phone: v })}
        />
        <Button
          label={form.is_active ? 'Status: active' : 'Status: inactive'}
          variant="secondary"
          onPress={() => setForm({ ...form, is_active: !form.is_active })}
        />
      </AdminFormScreen>

      {!isNew ? (
        <Card
          title="Parents / guardians"
          description="Relationships link a school-managed parent account to this student (parent login sees the child after this)."
        >
          <GuardianPanel
            studentId={id}
            guardians={guardians.data ?? []}
            parentOptions={options.data?.parentOptions ?? []}
            onChanged={() => void guardians.reload()}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const GuardianPanel: React.FC<{
  studentId: string;
  guardians: Array<{
    id: string;
    parent_id: string;
    relationship: string;
    can_pick_up: boolean;
    is_primary: boolean;
    parent: { first_name: string; last_name: string; email: string } | null;
  }>;
  parentOptions: Array<{ id: string; label: string; hint?: string }>;
  onChanged: () => void;
}> = ({ studentId, guardians, parentOptions, onChanged }) => {
  const api = getGlobalSession().apiClient;
  const toast = useToast();
  const [linkParentId, setLinkParentId] = useState<string | null>(null);
  const [relationship, setRelationship] = useState('Guardian');
  const [busy, setBusy] = useState(false);

  const usedParents = useMemo(() => new Set(guardians.map((g) => g.parent_id)), [guardians]);
  const availableParents = parentOptions.filter((option) => !usedParents.has(option.id));

  const link = async (): Promise<void> => {
    if (!linkParentId) {
      toast.show('Pick a parent account first.', 'danger');
      return;
    }
    setBusy(true);
    try {
      await api.createStudentGuardian(studentId, {
        parent_id: linkParentId,
        relationship: relationship.trim() || 'Guardian',
        can_pick_up: true,
        is_primary: guardians.length === 0,
      });
      toast.show('Parent linked.', 'success');
      setLinkParentId(null);
      onChanged();
    } catch (error) {
      toast.show(messageFromError(error, 'Could not link the parent.'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (parentId: string): Promise<void> => {
    const ok = await confirmAction(
      'Unlink this guardian?',
      'The parent will lose access to this child until relinked.',
      {
        confirmLabel: 'Unlink',
        destructive: true,
      },
    );
    if (!ok) {
      return;
    }
    try {
      await api.deleteStudentGuardian(studentId, parentId);
      toast.show('Guardian unlinked.', 'success');
      onChanged();
    } catch (error) {
      toast.show(messageFromError(error, 'Could not unlink.'), 'danger');
    }
  };

  return (
    <View>
      {guardians.length === 0 ? <EmptyState title="No guardians linked" icon="👪" /> : null}
      {guardians.map((guardian) => (
        <ListRow
          key={guardian.id}
          title={
            guardian.parent
              ? `${guardian.parent.first_name} ${guardian.parent.last_name}`
              : 'Parent account'
          }
          subtitle={`${guardian.relationship}${guardian.parent ? ` · ${guardian.parent.email}` : ''}`}
          right={
            <>
              {guardian.is_primary ? <StatusBadge tone="info" label="PRIMARY" compact /> : null}
              <Button
                label="Unlink"
                small
                variant="danger"
                onPress={() => void unlink(guardian.parent_id)}
              />
            </>
          }
        />
      ))}
      <Select
        label="Link existing parent"
        options={availableParents}
        value={linkParentId}
        placeholder={
          availableParents.length === 0 ? 'All parents already linked' : 'Choose a parent account'
        }
        onPick={setLinkParentId}
      />
      <TextField
        label="Relationship"
        value={relationship}
        onChangeText={setRelationship}
        placeholder="Mother, Father, Guardian…"
      />
      <Button
        label={busy ? 'Linking…' : 'Link parent to student'}
        busy={busy}
        onPress={() => void link()}
        variant="secondary"
        fullWidth
      />
    </View>
  );
};
