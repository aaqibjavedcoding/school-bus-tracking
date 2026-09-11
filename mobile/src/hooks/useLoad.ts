import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../lib/errors';

/**
 * Generic loader hook (mobile port of the web `useLoad`): runs `loader`,
 * keeps `{ data, loading, refreshing, error }` and exposes `reload`/`refresh`.
 * Errors are already mapped to a user-facing message, including ApiClientError
 * envelopes.
 *
 * Two deliberately separate progress signals:
 *
 *  - `loading` — the *blocking* signal: flips for the initial load and every
 *    dependency-driven reload. Screens show their empty/loading state from it
 *    (`loading && !data`).
 *  - `refreshing` — the *user pull* signal, driven exclusively by `refresh()`.
 *    Background work (stale-while-revalidate fetches, socket-triggered
 *    reloads, token refresh behind a 401) never touches it, so no global
 *    "refreshing" indicator can linger on top of genuinely working screens.
 *
 * Includes stale-response and unmount guards so rapid navigation or fast
 * dependency changes never write into a component that has already moved on.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mounted = useRef(true);
  const requestId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (!mounted.current || id !== requestId.current) return;
      setData(result);
    } catch (caught) {
      if (!mounted.current || id !== requestId.current) return;
      setError(getApiErrorMessage(caught));
    } finally {
      if (mounted.current && id === requestId.current) {
        setLoading(false);
      }
    }
  }, []);

  /**
   * User-initiated refresh (pull-to-refresh). Shares the stale-guard with
   * `reload` but reports progress on `refreshing` only: the screen stays as
   * it is and the pull indicator is the only visible feedback.
   */
  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setRefreshing(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (!mounted.current || id !== requestId.current) return;
      setData(result);
    } catch (caught) {
      if (!mounted.current || id !== requestId.current) return;
      setError(getApiErrorMessage(caught));
    } finally {
      if (mounted.current && id === requestId.current) {
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, ...deps]);

  return { data, setData, loading, refreshing, error, reload, refresh };
}
