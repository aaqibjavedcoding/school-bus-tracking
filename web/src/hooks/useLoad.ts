'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiErrorMessage } from '../lib/errors';

export interface UseLoadOptions {
  /**
   * Gate the request instead of only gating the *render*.
   *
   * While `enabled` is `false` the hook never fetches: it reports idle
   * (not loading) and keeps whatever data it already has. Flip it to `true`
   * (e.g. when a modal opens) and the loader runs — form dropdowns can
   * therefore defer their lookups until the form is actually shown instead
   * of paying for them on every page mount. Data already fetched stays
   * cached in the hook when the gate closes again.
   */
  enabled?: boolean;
}

export function useLoad<T>(
  loader: () => Promise<T>,
  deps: unknown[] = [],
  options: UseLoadOptions = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mounted = useRef(true);
  const requestId = useRef(0);
  const enabledRef = useRef(options.enabled);
  enabledRef.current = options.enabled;

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
      // Guard against stale responses and unmounted components.
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
    if (enabledRef.current === false) {
      // Gated off: nothing requested yet. Drop the initial spinner (there is
      // nothing to wait for) and keep any previously loaded data cached.
      if (requestId.current === 0) {
        setLoading(false);
      }
      return;
    }
    void reload();
  }, [reload, options.enabled, ...deps]);

  return { data, setData, loading, error, reload };
}
