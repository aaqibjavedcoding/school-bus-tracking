/**
 * Active / inactive narrowing shared by every school-admin list screen.
 *
 * The REST list endpoints expose `page`, `limit` and `search` only — there is
 * no `is_active` query parameter — so this filters the page that was actually
 * loaded rather than inventing an API contract.
 */

export type ActiveFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

export const ACTIVE_FILTER_OPTIONS: ReadonlyArray<{ value: ActiveFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
];

export function filterByActive<T extends { is_active: boolean }>(
  items: T[],
  filter: ActiveFilter,
): T[] {
  if (filter === 'ALL') return items;
  const wanted = filter === 'ACTIVE';
  return items.filter((item) => item.is_active === wanted);
}

export function activeFilterLabel(filter: ActiveFilter): string {
  return ACTIVE_FILTER_OPTIONS.find((option) => option.value === filter)?.label ?? 'All';
}
