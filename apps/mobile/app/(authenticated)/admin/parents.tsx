import React from 'react';
import { AdminEntityList, type AdminRow } from '../../../src/features/admin/admin-shared';
import { useParents } from '../../../src/features/admin/admin-hooks';

export default function AdminParentsScreen() {
  const parents = useParents();

  const rows: AdminRow[] = parents.items.map((parent) => ({
    id: parent.id,
    title: `${parent.first_name} ${parent.last_name}`,
    subtitle: parent.email,
    meta: parent.phone ?? undefined,
    badge: parent.is_active
      ? { label: 'ACTIVE', tone: 'success' }
      : { label: 'INACTIVE', tone: 'neutral' },
    detailHref: `/admin/parents/${parent.id}`,
    onDelete: async () => parents.remove(parent.id),
    deleteLabel:
      'Existing parent accounts are managed on the web console; delete only when unreferenced (the API enforces it).',
  }));

  return (
    <AdminEntityList
      rows={rows}
      loading={parents.loading}
      refreshing={parents.refreshing}
      error={parents.error}
      onRefresh={() => void parents.refresh()}
      onSearch={parents.setSearch}
      searchPlaceholder="Name or email…"
      newLabel="Add parent account"
      newHref="/admin/parents/new"
      emptyTitle="No parent accounts"
      emptyMessage="Create a PARENT login, then link children from the student screen (or below)."
    />
  );
}
