import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../lib/errors';

/**
 * Generic loader hook (mobile port of the web `useLoad`): runs `loader`,
 * keeps `{ data, loading, error }` and exposes `reload`. Errors are already
 * mapped to a user-facing message, including ApiClientError envelopes.
 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await loaderRef.current();
      setData(result);
    } catch (caught) {
      setError(getApiErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload, ...deps]);

  return { data, setData, loading, error, reload };
}
