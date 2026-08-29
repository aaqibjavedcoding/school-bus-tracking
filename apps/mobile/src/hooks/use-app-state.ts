import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/**
 * Runs `onChange` on every app-foreground transition.
 *
 * Used to re-verify GPS/permissions and to re-snapshot trip data after the
 * phone wakes up: the socket client reconnects on its own, but permission or
 * service state may have changed while the app was suspended, and the trip
 * may have advanced server-side.
 */
export function useOnAppForeground(onChange: (state: AppStateStatus) => void): void {
  const handlerRef = useRef(onChange);
  handlerRef.current = onChange;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      handlerRef.current(next);
    });
    return () => subscription.remove();
  }, []);
}
