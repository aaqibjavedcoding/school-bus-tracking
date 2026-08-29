import React from 'react';
import { AdminEntityList, type AdminRow } from '../../../src/features/admin/admin-shared';
import { useStudents } from '../../../src/features/admin/admin-hooks';

export default function AdminStudentsScreen() {
  const students = useStudents();

  const rows: AdminRow[] = students.items.map((student) => ({
    id: student.id,
    title: `${student.first_name} ${student.last_name}`,
    subtitle: `${student.admission_number}${student.grade_level ? ` · Grade ${student.grade_level}` : ''}`,
    meta: student.home_stop_id
      ? 'Home stop assigned'
      : 'No home stop — will not appear on manifests',
    badge: student.is_active
      ? { label: 'ACTIVE', tone: 'success' }
      : { label: 'INACTIVE', tone: 'neutral' },
    detailHref: `/admin/students/${student.id}`,
    onDelete: async () => students.remove(student.id),
    deleteLabel: 'The API refuses to delete a student with attendance history (soft rules apply).',
  }));

  return (
    <AdminEntityList
      rows={rows}
      loading={students.loading}
      refreshing={students.refreshing}
      error={students.error}
      onRefresh={() => void students.refresh()}
      onSearch={students.setSearch}
      searchPlaceholder="Name or admission number…"
      newLabel="Add student"
      newHref="/admin/students/new"
      emptyTitle="No students yet"
      emptyMessage="Add students and assign home stops to build route manifests."
    />
  );
}
