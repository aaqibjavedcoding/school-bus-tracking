'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  ErrorState,
  PageHeader,
  Skeleton,
  useToast,
} from '../../../../../components/ui';
import { useLoad } from '../../../../../hooks/useLoad';
import { formatDateTime } from '../../../../../lib/format';
import { getApiErrorMessage, unwrapEnvelope } from '../../../../../lib/errors';
import { apiClient } from '../../../../../services/api';
import { SchoolSubscriptionSection } from '../../../../../features/admin/subscriptions/SchoolSubscriptionSection';
import { SchoolAdminsSection } from '../../../../../features/admin/school-admins/SchoolAdminsSection';
import { EditSchoolProfileDialog } from '../../../../../features/admin/schools/EditSchoolProfileDialog';

interface StatCard {
  label: string;
  value: number | string;
  hint?: string;
}

const StatGrid: React.FC<{ cards: StatCard[] }> = ({ cards }) => (
  <div className="stat-grid" style={{ marginBottom: '1.25rem' }}>
    {cards.map((card) => (
      <div className="stat-card" key={card.label}>
        <span className="label">{card.label}</span>
        <span className="value">{card.value}</span>
        {card.hint ? (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            {card.hint}
          </span>
        ) : null}
      </div>
    ))}
  </div>
);

export default function AdminSchoolDetailsPage() {
  const params = useParams<{ id: string }>();
  const schoolId = params.id;
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'activate' | 'deactivate' | null>(null);
  const [editProfileOpen, setEditProfileOpen] = useState(false);

  const { data, loading, error, reload, setData } = useLoad(async () => {
    const envelope = await apiClient.getAdminSchool(schoolId);
    return unwrapEnvelope(envelope);
  }, [schoolId]);

  const runLifecycle = async (action: 'activate' | 'deactivate') => {
    setBusy(true);
    try {
      if (action === 'deactivate') {
        await apiClient.deactivateAdminSchool(schoolId);
        toast.push('School deactivated — its users can no longer sign in', 'danger');
      } else {
        await apiClient.activateAdminSchool(schoolId);
        toast.push('School activated — access restored', 'success');
      }
      setData(null);
      await reload();
    } catch (caught) {
      toast.push(getApiErrorMessage(caught, 'Lifecycle action failed'), 'danger');
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <Skeleton lines={14} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <ErrorState
          title="Could not load school"
          message={error ?? 'Not found'}
          onRetry={() => void reload()}
        />
      </div>
    );
  }

  const { school, stats } = data;

  const saveProfile = (updated: { id: string }) => {
    setData((current) => {
      if (!current) return current;
      return { ...current, school: updated as typeof current.school };
    });
    setEditProfileOpen(false);
  };

  return (
    <div className="page">
      <PageHeader
        title={school.name}
        description={`Tenant code ${school.code}${school.subdomain ? ` · subdomain ${school.subdomain}` : ''}`}
        actions={
          <div className="row">
            <Badge tone={school.is_active ? 'success' : 'warning'}>
              {school.is_active ? 'Active' : 'Inactive'}
            </Badge>
            {school.is_active ? (
              <Button variant="danger" disabled={busy} onClick={() => setConfirm('deactivate')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="success" disabled={busy} onClick={() => setConfirm('activate')}>
                Activate
              </Button>
            )}
          </div>
        }
      />

      <Card title="Profile" description="Contact and operational details held for this tenant.">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.5rem' }}>
          <Button variant="secondary" size="md" onClick={() => setEditProfileOpen(true)}>
            Edit profile
          </Button>
        </div>
        <div className="grid grid-2" style={{ gap: '0.5rem 2rem' }}>
          <Detail label="Email" value={school.email} />
          <Detail label="Phone" value={school.phone} />
          <Detail label="City" value={school.city} />
          <Detail label="State / region" value={school.state} />
          <Detail label="Address" value={school.address_line1} />
          <Detail label="Postal code" value={school.postal_code} />
          <Detail label="Country" value={school.country} />
          <Detail label="Timezone" value={school.timezone} />
          <Detail label="Created" value={formatDateTime(school.created_at)} />
          <Detail label="Last updated" value={formatDateTime(school.updated_at)} />
        </div>
      </Card>

      <Card
        title="Students & staff"
        description="Active counts reflect enabled, non-deleted accounts in this tenant."
      >
        <StatGrid
          cards={[
            {
              label: 'Students',
              value: stats.student_count,
              hint: `${stats.active_student_count} active`,
            },
            {
              label: 'School admins',
              value: stats.admin_count,
              hint: `${stats.active_admin_count} active`,
            },
            { label: 'Drivers', value: stats.driver_count },
            { label: 'Conductors', value: stats.conductor_count },
            {
              label: 'Active crew',
              value: stats.active_staff_count,
              hint: 'Active drivers + conductors',
            },
            { label: 'Parents', value: stats.parent_count },
          ]}
        />
      </Card>

      <Card title="Transport" description="Fleet, routes and trip activity.">
        <StatGrid
          cards={[
            { label: 'Buses', value: stats.bus_count, hint: `${stats.active_bus_count} active` },
            {
              label: 'Routes',
              value: stats.route_count,
              hint: `${stats.active_route_count} active`,
            },
            {
              label: 'Trips',
              value: stats.trip_count,
              hint: `${stats.active_trip_count} scheduled / boarding / in progress`,
            },
          ]}
        />
      </Card>

      <SchoolAdminsSection schoolId={schoolId} schoolName={school.name} />

      <SchoolSubscriptionSection schoolId={schoolId} schoolName={school.name} />

      <div className="row">
        <Link href="/admin/schools">
          <Button variant="secondary">Back to schools</Button>
        </Link>
      </div>

      <EditSchoolProfileDialog
        open={editProfileOpen}
        school={school}
        onClose={() => setEditProfileOpen(false)}
        onSaved={saveProfile}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm === 'deactivate' ? `Deactivate ${school.name}?` : `Activate ${school.name}?`}
        message={
          confirm === 'deactivate'
            ? 'All users of this school (admins, drivers, conductors and parents) will immediately lose access, including sessions already signed in. No data is deleted — students, staff, buses, routes, trips, attendance and GPS history are all preserved — and activation restores full access.'
            : 'Access for this school and all of its users will be fully restored. No data was removed while inactive.'
        }
        confirmLabel={confirm === 'deactivate' ? 'Deactivate school' : 'Activate school'}
        danger={confirm === 'deactivate'}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm;
          setConfirm(null);
          if (action) void runLifecycle(action);
        }}
      />
    </div>
  );
}

const Detail: React.FC<{ label: string; value: string | null | undefined }> = ({
  label,
  value,
}) => (
  <div>
    <div
      className="muted"
      style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}
    >
      {label}
    </div>
    <div>{value && value.trim() ? value : '—'}</div>
  </div>
);
