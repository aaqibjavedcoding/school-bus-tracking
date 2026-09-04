'use client';

import Link from 'next/link';
import React from 'react';
import { Card, ErrorState, PageHeader, Skeleton } from '../../../components/ui';
import { useLoad } from '../../../hooks/useLoad';
import { unwrapEnvelope } from '../../../lib/errors';
import { fullName } from '../../../lib/format';
import { apiClient } from '../../../services/api';

export default function ChildrenPage() {
  const { data, loading, error, reload } = useLoad(async () => {
    const links = unwrapEnvelope(await apiClient.listMyStudents()).items.filter(
      (link) => link.is_active,
    );
    const students = await Promise.all(
      links.map(async (link) => ({
        link,
        student: unwrapEnvelope(await apiClient.getStudent(link.student_id)),
      })),
    );
    return students;
  }, []);

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
        <ErrorState message={error || 'Could not load children'} onRetry={() => void reload()} />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="My children"
        description="Follow today's trip, the live map, and boarding status."
      />
      {data.length === 0 ? (
        <Card>
          <p className="muted">No children are linked to this parent account yet.</p>
        </Card>
      ) : (
        <div className="grid grid-2">
          {data.map(({ student, link }) => (
            <Card key={student.id}>
              <h2>{fullName(student)}</h2>
              <p className="muted">
                {student.admission_number}
                {student.grade_level ? ` · ${student.grade_level}` : ''}
              </p>
              <p className="muted">{link.relationship}</p>
              <div style={{ marginTop: '0.85rem' }}>
                <Link className="btn btn-primary" href={`/children/${student.id}`}>
                  View trip
                </Link>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
