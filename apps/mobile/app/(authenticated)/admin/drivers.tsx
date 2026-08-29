import React from 'react';
import { AdminEntityList, type AdminRow } from '../../../src/features/admin/admin-shared';
import { useDrivers } from '../../../src/features/admin/admin-hooks';

export default function AdminDriversScreen() {
  const drivers = useDrivers();

  const rows: AdminRow[] = drivers.items.map((driver) => ({
    id: driver.id,
    title: `${driver.first_name} ${driver.last_name}`,
    subtitle: driver.email,
    meta: driver.phone ?? undefined,
    badge: driver.is_active
      ? { label: 'ACTIVE', tone: 'success' }
      : { label: 'INACTIVE', tone: 'neutral' },
    detailHref: `/admin/drivers/${driver.id}`,
    onDelete: async () => drivers.remove(driver.id),
    deleteLabel:
      'Drivers with assignments or trip history are refused by the API — deactivate instead.',
  }));

  return (
    <AdminEntityList
      rows={rows}
      loading={drivers.loading}
      refreshing={drivers.refreshing}
      error={drivers.error}
      onRefresh={() => void drivers.refresh()}
      onSearch={drivers.setSearch}
      searchPlaceholder="Name or email…"
      newLabel="Add driver"
      newHref="/admin/drivers/new"
      emptyTitle="No drivers yet"
      emptyMessage="Create driver accounts, then assign them on the Assignments screen."
    />
  );
}
