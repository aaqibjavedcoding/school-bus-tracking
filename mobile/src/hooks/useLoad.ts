import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../lib/errors';

/**
 * Generic loader hook (mobile port of the web `useLoad`): runs `loader`,
 * keeps `{ data, loading, error }` and exposes `reload`. Errors are already
 * mapped to a user-facing message, including ApiClientError envelopes.
 *
 * Includes stale-response and unmount guards so rapid navigation or fast
 * dependency changes never write into a component that has already moved on.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    void reload();
  }, [reload, ...deps]);

  return { data, setData, loading, error, reload };
}
