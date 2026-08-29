import { useEffect, useState } from 'react';
import NetInfo from '@react-native-community/netinfo';

export type NetworkStatus = 'online' | 'offline' | 'unknown';

/**
 * Device connectivity for the crew GPS/network status chips and the parent
 * tracking screen. Uses the same source of truth as the OS (RN NetInfo), not
 * a hand-rolled ping.
 */
export function useNetworkStatus(): NetworkStatus {
  const [status, setStatus] = useState<NetworkStatus>('unknown');

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.type === 'unknown' || state.isInternetReachable === null) {
        setStatus('unknown');
        return;
      }
      setStatus(state.isConnected && state.isInternetReachable !== false ? 'online' : 'offline');
    });
    return unsubscribe;
  }, []);

  return status;
}
