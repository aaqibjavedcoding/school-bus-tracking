'use client';

import Link from 'next/link';
import React from 'react';
import { Badge, Button, useToast } from '../../components/ui';
import { useManagedSchool } from './ManagedSchoolProvider';

/**
 * Persistent "Assisted Management — <School>" banner.
 *
 * Rendered by the AppShell on every authenticated page (platform pages
 * included) for as long as the managed-school context is active, so the
 * Super Admin can never mistake which school's data they are working on.
 * `Exit` closes the assisted-management session and returns to the schools
 * list; the banner never claims to be the school admin — the wording always
 * says the operator is acting on the school's behalf.
 */
export const ManagedSchoolBanner: React.FC = () => {
  const { managed, busy, verifying, exitSchool } = useManagedSchool();
  const toast = useToast();

  if (!managed) {
    return null;
  }

  return (
    <div className="managed-banner" role="region" aria-label="Assisted management context">
      <div className="managed-banner__identity">
        <span className="managed-banner__mark" aria-hidden="true">
          ★
        </span>
        <div>
          <strong>
            Assisted Management — {managed.schoolName}
            {managed.schoolCode ? (
              <code className="managed-banner__code"> {managed.schoolCode}</code>
            ) : null}
          </strong>
          <span className="managed-banner__hint">
            You are helping manage this school&apos;s operational data as the platform Super Admin.
            Every change is recorded in the school&apos;s audit trail under your account.
          </span>
        </div>
      </div>
      <div className="managed-banner__actions">
        {!managed.schoolIsActive ? (
          <Badge tone="warning">School inactive — read-only</Badge>
        ) : verifying ? (
          <Badge tone="neutral">Restoring session…</Badge>
        ) : null}
        <Link href={`/admin/schools/${managed.schoolId}`} className="managed-banner__profile">
          School profile
        </Link>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            void (async () => {
              try {
                await exitSchool();
                toast.push(`Exited assisted management of ${managed.schoolName}.`, 'info');
              } catch (error) {
                toast.push(
                  error instanceof Error ? error.message : 'Unable to exit assisted management.',
                  'danger',
                );
              }
            })();
          }}
        >
          {busy ? 'Exiting…' : 'Exit'}
        </Button>
      </div>
    </div>
  );
};
