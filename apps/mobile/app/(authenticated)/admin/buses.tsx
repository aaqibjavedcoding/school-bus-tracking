import React from 'react';
import { AdminEntityList, type AdminRow } from '../../../src/features/admin/admin-shared';
import { useBuses } from '../../../src/features/admin/admin-hooks';

export default function AdminBusesScreen() {
  const buses = useBuses();

  const rows: AdminRow[] = buses.items.map((bus) => ({
    id: bus.id,
    title: bus.bus_number ? `Bus ${bus.bus_number}` : bus.registration_number,
    subtitle: bus.registration_number,
    meta: `Capacity ${bus.capacity}`,
    badge: bus.is_active
      ? { label: 'IN FLEET', tone: 'success' }
      : { label: 'DEACTIVATED', tone: 'neutral' },
    detailHref: `/admin/buses/${bus.id}`,
    onDelete: async () => buses.remove(bus.id),
    deleteLabel:
      'Buses in active assignments or with trip history cannot be removed — the API says so.',
  }));

  return (
    <AdminEntityList
      rows={rows}
      loading={buses.loading}
      refreshing={buses.refreshing}
      error={buses.error}
      onRefresh={() => void buses.refresh()}
      onSearch={buses.setSearch}
      searchPlaceholder="Number or plate…"
      newLabel="Add bus"
      newHref="/admin/buses/new"
      emptyTitle="No buses yet"
      emptyMessage="Register the fleet so assignments can attach a vehicle."
    />
  );
}
