import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../lib/errors';
import { createLoaderProgressTracker } from './refresh-progress';

/**
 * Generic loader hook (mobile port of the web `useLoad`): runs `loader`,
 * keeps `{ data, loading, refreshing, error }` and exposes `reload`/`refresh`.
 * Errors are already mapped to a user-facing message, including ApiClientError
 * envelopes.
 *
 * Two deliberately separate progress signals, tracked by
 * {@link createLoaderProgressTracker}:
 *
 *  - `loading` — the *blocking* signal: flips for the initial load and every
 *    dependency-driven reload. Screens show their empty/loading state from it
 *    (`loading && !data`).
 *  - `refreshing` — the *user pull* signal, driven exclusively by `refresh()`.
 *    It is cleared when the pull itself finishes, even if a dependency-driven
 *    `reload()` started in the meantime — a background reload can never leave
 *    the pull indicator (the blue top bar) stuck on screen.
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
  const trackerRef = useRef<ReturnType<typeof createLoaderProgressTracker> | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createLoaderProgressTracker();
  }
  const tracker = trackerRef.current;

  useEffect(() => {
    tracker.mount();
    return () => {
      tracker.unmount();
    };
  }, [tracker]);

  const reload = useCallback(async () => {
    const id = tracker.startLoad();
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (!tracker.canWriteData(id)) return;
      setData(result);
    } catch (caught) {
      if (!tracker.canWriteData(id)) return;
      setError(getApiErrorMessage(caught));
    } finally {
      if (tracker.endLoad(id) === true) {
        setLoading(false);
      }
    }
  }, [tracker]);

  /**
   * User-initiated refresh (pull-to-refresh). Shares the stale-data guard
   * with `reload` but reports progress on `refreshing` only: the screen stays
   * as it is and the pull indicator is the only visible feedback. The flag is
   * cleared by the pull's own completion — a concurrent reload cannot strand
   * it.
   */
  const refresh = useCallback(async () => {
    const id = tracker.startRefresh();
    setRefreshing(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      if (!tracker.canWriteData(id)) return;
      setData(result);
    } catch (caught) {
      if (!tracker.canWriteData(id)) return;
      setError(getApiErrorMessage(caught));
    } finally {
      if (tracker.endRefresh(id) === true) {
        setRefreshing(false);
      }
    }
  }, [tracker]);

  useEffect(() => {
    void reload();
  }, [reload, ...deps]);

  return { data, setData, loading, refreshing, error, reload, refresh };
}
