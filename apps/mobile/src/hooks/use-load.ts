import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { getApiErrorMessage } from '../utils/errors';

/**
 * Generic data loader mirroring the web app's `useLoad`, with the mobile
 * extras: `refreshing` state for pull-to-refresh and `setData` for optimistic
 * merges of mutation responses.
 */
export interface UseLoadResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  reload: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Direct state setter — lets mutations merge server responses locally. */
  setData: Dispatch<SetStateAction<T | null>>;
}

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []): UseLoadResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'refresh') {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const result = await loaderRef.current();
      if (mountedRef.current) {
        setData(result);
      }
    } catch (caught) {
      if (mountedRef.current) {
        setError(getApiErrorMessage(caught));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void run('initial');
  }, [run, ...deps]);

  return {
    data,
    loading,
    refreshing,
    error,
    reload: () => run('initial'),
    refresh: () => run('refresh'),
    setData,
  };
}
