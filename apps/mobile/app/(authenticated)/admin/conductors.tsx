import React from 'react';
import { AdminEntityList, type AdminRow } from '../../../src/features/admin/admin-shared';
import { useConductors } from '../../../src/features/admin/admin-hooks';

export default function AdminConductorsScreen() {
  const conductors = useConductors();

  const rows: AdminRow[] = conductors.items.map((conductor) => ({
    id: conductor.id,
    title: `${conductor.first_name} ${conductor.last_name}`,
    subtitle: conductor.email,
    meta: conductor.phone ?? undefined,
    badge: conductor.is_active
      ? { label: 'ACTIVE', tone: 'success' }
      : { label: 'INACTIVE', tone: 'neutral' },
    detailHref: `/admin/conductors/${conductor.id}`,
    onDelete: async () => conductors.remove(conductor.id),
    deleteLabel:
      'Conductors with assignments or trip history are refused by the API — deactivate instead.',
  }));

  return (
    <AdminEntityList
      rows={rows}
      loading={conductors.loading}
      refreshing={conductors.refreshing}
      error={conductors.error}
      onRefresh={() => void conductors.refresh()}
      onSearch={conductors.setSearch}
      searchPlaceholder="Name or email…"
      newLabel="Add conductor"
      newHref="/admin/conductors/new"
      emptyTitle="No conductors yet"
      emptyMessage="Conductors run boarding & drop-off from the mobile app."
    />
  );
}
