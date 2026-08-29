import React from 'react';
import { AdminEntityList, type AdminRow } from '../../../src/features/admin/admin-shared';
import { useRoutes } from '../../../src/features/admin/admin-hooks';

export default function AdminRoutesScreen() {
  const routes = useRoutes();

  const rows: AdminRow[] = routes.items.map((route) => ({
    id: route.id,
    title: route.name,
    subtitle: route.code,
    meta: route.description ?? undefined,
    badge: route.is_active
      ? { label: 'ACTIVE', tone: 'success' }
      : { label: 'OFFLINE', tone: 'neutral' },
    detailHref: `/admin/routes/${route.id}`,
    onDelete: async () => routes.remove(route.id),
    deleteLabel: 'Routes with stops/assignments are refused by the API — deactivate instead.',
  }));

  return (
    <AdminEntityList
      rows={rows}
      loading={routes.loading}
      refreshing={routes.refreshing}
      error={routes.error}
      onRefresh={() => void routes.refresh()}
      onSearch={routes.setSearch}
      searchPlaceholder="Route name or code…"
      newLabel="Add route"
      newHref="/admin/routes/new"
      emptyTitle="No routes"
      emptyMessage="Create a route, then add ordered stops to it."
    />
  );
}
