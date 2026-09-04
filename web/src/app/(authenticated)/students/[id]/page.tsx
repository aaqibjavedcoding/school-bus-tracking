'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useState } from 'react';
import type { ParentResponse, StudentGuardianResponse } from '@school-bus-tracking/shared-types';
import { parentCreateSchema, studentGuardianCreateSchema } from '@school-bus-tracking/validation';
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Field,
  Input,
  Modal,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../../../../components/ui';
import { useLoad } from '../../../../hooks/useLoad';
import {
  fieldErrorsFromUnknown,
  fieldErrorsFromZod,
  getApiErrorMessage,
  unwrapEnvelope,
} from '../../../../lib/errors';
import { fullName, stopCode } from '../../../../lib/format';
import { apiClient } from '../../../../services/api';

export default function StudentDetailPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(async () => {
    const [student, guardians, parents, stops, routes] = await Promise.all([
      apiClient.getStudent(params.id),
      apiClient.listStudentGuardians(params.id),
      apiClient.listParents({ page: 1, limit: 100 }),
      apiClient.listStops({ page: 1, limit: 100 }),
      apiClient.listRoutes({ page: 1, limit: 100 }),
    ]);
    return {
      student: unwrapEnvelope(student),
      guardians: unwrapEnvelope(guardians).items,
      parents: unwrapEnvelope(parents).items,
      stops: unwrapEnvelope(stops).items,
      routes: unwrapEnvelope(routes).items,
    };
  }, [params.id]);

  const [linkOpen, setLinkOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [parentId, setParentId] = useState('');
  const [relationship, setRelationship] = useState('Parent');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [newParent, setNewParent] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    phone: '',
  });

  const linkGuardian = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = studentGuardianCreateSchema.safeParse({
      parent_id: parentId,
      relationship,
      is_primary: false,
      can_pick_up: true,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      unwrapEnvelope(await apiClient.createStudentGuardian(params.id, parsed.data));
      toast.push('Guardian linked.', 'success');
      setLinkOpen(false);
      await reload();
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const createParent = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parentCreateSchema.safeParse({
      ...newParent,
      phone: newParent.phone.trim() || undefined,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod(parsed.error));
      return;
    }
    setBusy(true);
    try {
      const created = unwrapEnvelope(await apiClient.createParent(parsed.data));
      unwrapEnvelope(
        await apiClient.createStudentGuardian(params.id, {
          parent_id: created.id,
          relationship: 'Parent',
          can_pick_up: true,
        }),
      );
      toast.push('Parent account created and linked.', 'success');
      setCreateOpen(false);
      await reload();
    } catch (caught) {
      setFieldErrors(fieldErrorsFromUnknown(caught));
      toast.push(getApiErrorMessage(caught), 'danger');
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (guardian: StudentGuardianResponse) => {
    try {
      await apiClient.deleteStudentGuardian(params.id, guardian.parent_id);
      toast.push('Guardian unlinked.', 'success');
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught), 'danger');
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="page">
        <ErrorState message={error || 'Student not found'} onRetry={() => void reload()} />
      </div>
    );
  }

  const parentName = (guardian: StudentGuardianResponse) => {
    const parent = data.parents.find((item: ParentResponse) => item.id === guardian.parent_id);
    return parent ? `${fullName(parent)} (${parent.email})` : 'Guardian unavailable';
  };
  const homeStop = data.stops.find((stop) => stop.id === data.student.home_stop_id);
  const homeStopRoute = data.routes.find((route) => route.id === homeStop?.route_id);
  const homeStopLabel =
    homeStop && homeStopRoute
      ? `${stopCode(homeStopRoute.code, homeStop.sequence_number)} — ${homeStop.name}`
      : 'Not assigned';

  return (
    <div className="page">
      <PageHeader
        title={fullName(data.student)}
        description={`Admission ${data.student.admission_number}`}
        actions={
          <Link className="btn btn-secondary" href="/students">
            Back to roster
          </Link>
        }
      />
      <div className="grid grid-2">
        <Card title="Profile">
          <p>Grade: {data.student.grade_level || '—'}</p>
          <p className="muted">Home stop: {homeStopLabel}</p>
          <p className="muted">
            Emergency: {data.student.emergency_contact_name || '—'}{' '}
            {data.student.emergency_contact_phone || ''}
          </p>
          <div style={{ marginTop: '0.6rem' }}>
            <Badge tone={data.student.is_active ? 'success' : 'neutral'}>
              {data.student.is_active ? 'Active' : 'Inactive'}
            </Badge>
          </div>
        </Card>
        <Card title="Guardians" description="Parents who can follow this child's trips.">
          <div className="row" style={{ marginBottom: '0.75rem' }}>
            <Button onClick={() => setLinkOpen(true)}>Link existing parent</Button>
            <Button variant="secondary" onClick={() => setCreateOpen(true)}>
              New parent account
            </Button>
          </div>
          {data.guardians.length === 0 ? (
            <p className="muted">No guardians linked.</p>
          ) : (
            data.guardians.map((guardian) => (
              <div key={guardian.id} className="manifest-item">
                <div>
                  <strong>{parentName(guardian)}</strong>
                  <div className="muted">{guardian.relationship}</div>
                </div>
                <Button variant="ghost" onClick={() => void unlink(guardian)}>
                  Unlink
                </Button>
              </div>
            ))
          )}
        </Card>
      </div>

      <Modal title="Link parent" open={linkOpen} onClose={() => setLinkOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void linkGuardian(event)}>
          <Field id="parent_id" label="Parent" error={fieldErrors.parent_id}>
            <Select
              id="parent_id"
              placeholder="Select parent"
              value={parentId}
              onChange={(event) => setParentId(event.target.value)}
              options={data.parents.map((parent) => ({
                value: parent.id,
                label: `${fullName(parent)} (${parent.email})`,
              }))}
            />
          </Field>
          <Field id="relationship" label="Relationship" error={fieldErrors.relationship}>
            <Input
              id="relationship"
              value={relationship}
              onChange={(event) => setRelationship(event.target.value)}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Link
            </Button>
          </div>
        </form>
      </Modal>

      <Modal title="Create parent account" open={createOpen} onClose={() => setCreateOpen(false)}>
        <form className="form-grid" onSubmit={(event) => void createParent(event)}>
          <Field id="np_first" label="First name" error={fieldErrors.first_name}>
            <Input
              id="np_first"
              value={newParent.first_name}
              onChange={(event) => setNewParent({ ...newParent, first_name: event.target.value })}
            />
          </Field>
          <Field id="np_last" label="Last name" error={fieldErrors.last_name}>
            <Input
              id="np_last"
              value={newParent.last_name}
              onChange={(event) => setNewParent({ ...newParent, last_name: event.target.value })}
            />
          </Field>
          <Field id="np_email" label="Email" error={fieldErrors.email}>
            <Input
              id="np_email"
              type="email"
              value={newParent.email}
              onChange={(event) => setNewParent({ ...newParent, email: event.target.value })}
            />
          </Field>
          <Field id="np_password" label="Password" error={fieldErrors.password}>
            <Input
              id="np_password"
              type="password"
              value={newParent.password}
              onChange={(event) => setNewParent({ ...newParent, password: event.target.value })}
            />
          </Field>
          <Field id="np_phone" label="Phone" error={fieldErrors.phone}>
            <Input
              id="np_phone"
              value={newParent.phone}
              onChange={(event) => setNewParent({ ...newParent, phone: event.target.value })}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Create and link
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
