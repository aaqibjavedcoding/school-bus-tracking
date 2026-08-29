import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

/**
 * Connectivity for the banner + guards. `offline` here means the OS reports
 * no network; the socket layer separately reports "reconnecting" for a
 * reachable-but-not-yet-connected server, matching the Task 23 brief:
 * `Offline` / `Reconnecting…`.
 */
export type NetworkStatus = 'online' | 'offline' | 'unknown';

export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>('unknown');

  useEffect(() => {
    let active = true;
    void NetInfo.fetch()
      .then((state) => {
        if (active) {
          setStatus(state.isConnected ? 'online' : 'offline');
        }
      })
      .catch(() => {
        if (active) {
          setStatus('online');
        }
      });
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (active) {
        setStatus(state.isConnected ? 'online' : 'offline');
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return status;
}
