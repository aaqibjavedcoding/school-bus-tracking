import { useMemo, useState } from 'react';
import {
  ACTIVE_FILTER_OPTIONS,
  activeFilterLabel,
  filterByActive,
  type ActiveFilter,
} from '../lib/active-filter';

/**
 * React binding over the pure `filterByActive` helper: holds the selected
 * chip and derives the visible rows. `ACTIVE_FILTER_OPTIONS` is rendered with
 * `<FilterChips />`.
 */
export function useActiveFilter<T extends { is_active: boolean }>(items: T[]) {
  const [filter, setFilter] = useState<ActiveFilter>('ALL');
  const visible = useMemo(() => filterByActive(items, filter), [items, filter]);
  return {
    filter,
    setFilter,
    visible,
    isFiltered: filter !== 'ALL',
    reset: () => setFilter('ALL'),
    label: activeFilterLabel(filter),
  };
}

export { ACTIVE_FILTER_OPTIONS, filterByActive };
export type { ActiveFilter };
