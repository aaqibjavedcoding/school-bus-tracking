'use client';

import Link from 'next/link';
import React, { useState } from 'react';
import {
  StudentGender,
  type StudentCreateRequest,
  type StudentResponse,
  type StudentUpdateRequest,
} from '@school-bus-tracking/shared-types';
import { studentCreateSchema, studentUpdateSchema } from '@school-bus-tracking/validation';
import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '../../../components/ui';
import { usePagedResource } from '../../../hooks/usePagedResource';
import {
  emptyToNull,
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../lib/errors';
import { fullName } from '../../../lib/format';
import { apiClient } from '../../../services/api';

const GENDER_OPTIONS = [
  { value: StudentGender.MALE, label: 'Male' },
  { value: StudentGender.FEMALE, label: 'Female' },
  { value: StudentGender.OTHER, label: 'Other' },
];

const emptyForm = {
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

type FormState = typeof emptyForm;

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

export default function StudentsPage() {
  const toast = useToast();
  const list = usePagedResource(
    async (page, search) =>
      unwrapEnvelope(await apiClient.listStudents({ page, limit: 20, search })),
    [],
  );
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StudentResponse | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<StudentResponse | null>(null);

  const startCreate = () => {
    setEditing(null);
    setForm(emptyForm);
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

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
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
        unwrapEnvelope(
          await apiClient.updateStudent(editing.id, parsed.data as StudentUpdateRequest),
        );
        toast.push('Student updated.', 'success');
      } else {
        unwrapEnvelope(await apiClient.createStudent(parsed.data as StudentCreateRequest));
        toast.push('Student created.', 'success');
      }
      setOpen(false);
      await list.reload();
    } catch (error) {
      setFieldErrors(fieldErrorsFromUnknown(error));
      toast.push(getApiErrorMessage(error), 'danger');
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
    } catch (error) {
      toast.push(getApiErrorMessage(error), 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Students"
        description="Roster, home stops and emergency contacts."
        actions={<Button onClick={startCreate}>Add student</Button>}
      />
      <div className="toolbar">
        <Input
          className="search"
          placeholder="Search name or admission number"
          value={list.search}
          onChange={(event) => list.setSearch(event.target.value)}
        />
      </div>
      {list.loading ? (
        <Skeleton lines={8} />
      ) : list.error ? (
        <ErrorState message={list.error} onRetry={() => void list.reload()} />
      ) : list.items.length === 0 ? (
        <EmptyState
          title="No students yet"
          description="Add the first student to start building route manifests."
          action={<Button onClick={startCreate}>Add student</Button>}
        />
      ) : (
        <>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Admission</th>
                  <th>Grade</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((student) => (
                  <tr key={student.id}>
                    <td>
                      <Link className="linkish" href={`/students/${student.id}`}>
                        {fullName(student)}
                      </Link>
                    </td>
                    <td>{student.admission_number}</td>
                    <td>{student.grade_level || '—'}</td>
                    <td>
                      <Badge tone={student.is_active ? 'success' : 'neutral'}>
                        {student.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button variant="secondary" onClick={() => startEdit(student)}>
                          Edit
                        </Button>
                        <Button variant="ghost" onClick={() => setPendingDelete(student)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={list.meta.page}
            totalPages={list.meta.totalPages}
            hasNextPage={list.meta.hasNextPage}
            hasPreviousPage={list.meta.hasPreviousPage}
            onPage={list.setPage}
          />
        </>
      )}

      <Modal
        title={editing ? 'Edit student' : 'Add student'}
        open={open}
        onClose={() => setOpen(false)}
      >
        <form className="form-grid" onSubmit={(event) => void save(event)}>
          <div className="grid grid-2">
            <Field id="first_name" label="First name" error={fieldErrors.first_name}>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(event) => setForm({ ...form, first_name: event.target.value })}
              />
            </Field>
            <Field id="last_name" label="Last name" error={fieldErrors.last_name}>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(event) => setForm({ ...form, last_name: event.target.value })}
              />
            </Field>
          </div>
          <Field
            id="admission_number"
            label="Admission number"
            error={fieldErrors.admission_number}
          >
            <Input
              id="admission_number"
              value={form.admission_number}
              onChange={(event) => setForm({ ...form, admission_number: event.target.value })}
            />
          </Field>
          <div className="grid grid-2">
            <Field id="date_of_birth" label="Date of birth" error={fieldErrors.date_of_birth}>
              <Input
                id="date_of_birth"
                type="date"
                value={form.date_of_birth}
                onChange={(event) => setForm({ ...form, date_of_birth: event.target.value })}
              />
            </Field>
            <Field id="gender" label="Gender" error={fieldErrors.gender}>
              <Select
                id="gender"
                placeholder="Unspecified"
                options={GENDER_OPTIONS}
                value={form.gender}
                onChange={(event) => setForm({ ...form, gender: event.target.value })}
              />
            </Field>
          </div>
          <Field id="grade_level" label="Grade" error={fieldErrors.grade_level}>
            <Input
              id="grade_level"
              value={form.grade_level}
              onChange={(event) => setForm({ ...form, grade_level: event.target.value })}
            />
          </Field>
          <Field
            id="home_stop_id"
            label="Home stop ID"
            error={fieldErrors.home_stop_id}
            hint="UUID of the student's boarding stop"
          >
            <Input
              id="home_stop_id"
              value={form.home_stop_id}
              onChange={(event) => setForm({ ...form, home_stop_id: event.target.value })}
            />
          </Field>
          <Field
            id="emergency_contact_name"
            label="Emergency contact"
            error={fieldErrors.emergency_contact_name}
          >
            <Input
              id="emergency_contact_name"
              value={form.emergency_contact_name}
              onChange={(event) => setForm({ ...form, emergency_contact_name: event.target.value })}
            />
          </Field>
          <Field
            id="emergency_contact_phone"
            label="Emergency phone"
            error={fieldErrors.emergency_contact_phone}
          >
            <Input
              id="emergency_contact_phone"
              value={form.emergency_contact_phone}
              onChange={(event) =>
                setForm({ ...form, emergency_contact_phone: event.target.value })
              }
            />
          </Field>
          <Field id="medical_notes" label="Medical notes" error={fieldErrors.medical_notes}>
            <Textarea
              id="medical_notes"
              value={form.medical_notes}
              onChange={(event) => setForm({ ...form, medical_notes: event.target.value })}
            />
          </Field>
          <label className="row">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm({ ...form, is_active: event.target.checked })}
            />
            Active
          </label>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Delete student?"
        message={
          pendingDelete ? `${fullName(pendingDelete)} will be removed from the active roster.` : ''
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}
