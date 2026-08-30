import { useCallback, useEffect, useRef, useState } from 'react';
import type { PaginationMeta } from '@school-bus-tracking/shared-types';
import { getApiErrorMessage } from '../lib/errors';

/**
 * Mobile port of the web `usePagedResource`: paginated + debounced-search
 * list state used by the school-admin CRUD screens. Keeps the same shape as
 * the web hook so the screens read identically across platforms.
 */

const EMPTY_META: PaginationMeta = {
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
  hasNextPage: false,
  hasPreviousPage: false,
};

export function usePagedResource<T>(
  loader: (page: number, search: string) => Promise<{ items: T[]; meta: PaginationMeta }>,
  deps: unknown[] = [],
) {
  const [items, setItems] = useState<T[]>([]);
  const [meta, setMeta] = useState<PaginationMeta>(EMPTY_META);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    setSearching(true);
    const handle = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setSearching(false);
    }, 300);
    return () => clearTimeout(handle);
  }, [search]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current(page, debouncedSearch);
      setItems(result.items);
      setMeta(result.meta);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, debouncedSearch]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch]);

  return {
    items,
    meta,
    page,
    setPage,
    search,
    setSearch,
    loading,
    searching,
    error,
    reload,
    setItems,
  };
}
