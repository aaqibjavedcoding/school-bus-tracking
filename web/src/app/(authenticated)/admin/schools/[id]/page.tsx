'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import React, { useState } from 'react';
import { SUBSCRIPTION_STATUS_LABELS } from '@school-bus-tracking/shared-types';
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
import { KpiCard, KpiGrid } from '../../../../../features/admin/components/KpiCard';
import { useManagedSchool } from '../../../../../features/managed';
import { subscriptionStatusTone } from '../../../../../features/admin/subscriptions/helpers';

const number = (value: number | undefined): string => new Intl.NumberFormat().format(value ?? 0);

/**
 * School 360 view of the Super Admin console (`/admin/schools/[id]`).
 *
 * One `GET /admin/schools/:id` call provides the profile, the tenant resource
 * statistics and the subscription summary; the admins and subscription panels
 * own their own data so a mutation in one never refetches the whole page. The
 * managed tenant is always identified by the route id and authorised
 * server-side — the client never sends a tenant claim of its own.
 */
export default function AdminSchoolDetailsPage() {
  const params = useParams<{ id: string }>();
  const schoolId = params.id;
  const toast = useToast();
  const { enterSchool, busy: entering, managed } = useManagedSchool();

  const enterManageData = async () => {
    if (!data) return;
    try {
      await enterSchool({
        id: data.school.id,
        name: data.school.name,
        code: data.school.code,
        is_active: data.school.is_active,
      });
    } catch (error) {
      toast.push(
        error instanceof Error
          ? error.message
          : 'Unable to start assisted management for this school.',
        'danger',
      );
    }
  };
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
        toast.push('School deactivated — its users can no longer sign in.', 'danger');
      } else {
        await apiClient.activateAdminSchool(schoolId);
        toast.push('School activated — access restored.', 'success');
      }
      await reload();
    } catch (caught) {
      toast.push(
        getApiErrorMessage(
          caught,
          `Unable to ${action} this school. Please try again in a moment.`,
        ),
        'danger',
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return (
      <div className="page">
        <PageHeader title="School" description="Loading the tenant overview…" />
        <Skeleton lines={6} />
        <Card title="Loading">
          <Skeleton lines={8} />
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="page">
        <PageHeader title="School" />
        <ErrorState
          title="Unable to load this school"
          message={error ?? 'The school could not be found or is no longer available.'}
          onRetry={() => void reload()}
        />
        <div className="row">
          <Link href="/admin/schools">
            <Button variant="secondary">Back to schools</Button>
          </Link>
        </div>
      </div>
    );
  }

  const { school, stats, subscription } = data;

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
          <>
            {managed?.schoolId === schoolId ? (
              <Link href="/students">
                <Button variant="secondary">Managing… open workspace</Button>
              </Link>
            ) : (
              <Button variant="primary" disabled={entering || !data} onClick={() => void enterManageData()}>
                {entering ? 'Entering…' : 'Manage data'}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditProfileOpen(true)}>
              Edit profile
            </Button>
            {school.is_active ? (
              <Button variant="danger" disabled={busy} onClick={() => setConfirm('deactivate')}>
                Deactivate
              </Button>
            ) : (
              <Button variant="success" disabled={busy} onClick={() => setConfirm('activate')}>
                Activate
              </Button>
            )}
          </>
        }
      />

      <div className="row" style={{ flexWrap: 'wrap', marginBottom: '0.25rem' }}>
        <Badge tone={school.is_active ? 'success' : 'warning'}>
          {school.is_active ? 'Active tenant' : 'Inactive tenant'}
        </Badge>
        <Badge tone={subscriptionStatusTone(subscription.status)}>
          {SUBSCRIPTION_STATUS_LABELS[subscription.status]}
        </Badge>
        {subscription.plan ? <Badge tone="neutral">{subscription.plan.name}</Badge> : null}
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Created {formatDateTime(school.created_at)}
        </span>
      </div>

      <Card
        title="Resource overview"
        description="Everything this tenant currently holds. Counts come from the tenant's own records."
      >
        <KpiGrid>
          <KpiCard
            label="Students"
            value={number(stats.student_count)}
            hint={`${number(stats.active_student_count)} active`}
          />
          <KpiCard label="Parents / Guardians" value={number(stats.parent_count)} />
          <KpiCard
            label="Buses"
            value={number(stats.bus_count)}
            hint={`${number(stats.active_bus_count)} active`}
          />
          <KpiCard label="Drivers" value={number(stats.driver_count)} />
          <KpiCard label="Conductors" value={number(stats.conductor_count)} />
          <KpiCard
            label="Routes"
            value={number(stats.route_count)}
            hint={`${number(stats.active_route_count)} active`}
          />
          <KpiCard label="Stops" value={number(stats.stop_count)} />
          <KpiCard
            label="Assignments"
            value={number(stats.assignment_count)}
            hint={`${number(stats.active_assignment_count)} active`}
          />
          <KpiCard
            label="School admins"
            value={number(stats.admin_count)}
            hint={`${number(stats.active_admin_count)} active`}
          />
          <KpiCard
            label="Trips"
            value={number(stats.trip_count)}
            hint={`${number(stats.active_trip_count)} scheduled / boarding / in progress`}
          />
        </KpiGrid>
      </Card>

      <Card title="School profile" description="Identity and contact details held for this tenant.">
        <div className="detail-grid">
          <Detail label="Name" value={school.name} />
          <Detail label="Code" value={school.code} mono />
          <Detail label="Subdomain" value={school.subdomain} mono />
          <Detail label="Email" value={school.email} />
          <Detail label="Phone" value={school.phone} />
          <Detail label="Address" value={joinAddress(school.address_line1, school.address_line2)} />
          <Detail label="City" value={school.city} />
          <Detail label="State / region" value={school.state} />
          <Detail label="Postal code" value={school.postal_code} />
          <Detail label="Country" value={school.country} />
          <Detail label="Timezone" value={school.timezone} />
          <Detail label="Status" value={school.is_active ? 'Active' : 'Inactive'} />
          <Detail label="Created" value={formatDateTime(school.created_at)} />
          <Detail label="Last updated" value={formatDateTime(school.updated_at)} />
        </div>
      </Card>

      <SchoolAdminsSection schoolId={schoolId} schoolName={school.name} />

      <SchoolSubscriptionSection schoolId={schoolId} schoolName={school.name} stats={stats} />

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

function joinAddress(line1: string | null, line2: string | null): string | null {
  return [line1, line2].filter((part) => part && part.trim()).join(', ') || null;
}

const Detail: React.FC<{ label: string; value: string | null | undefined; mono?: boolean }> = ({
  label,
  value,
  mono = false,
}) => (
  <div>
    <div className="detail-item__label">{label}</div>
    <div className="detail-item__value">
      {value && value.trim() ? mono ? <code>{value}</code> : value : '—'}
    </div>
  </div>
);
