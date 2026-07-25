import { useEffect, useState } from 'react';

import type { ConnectivityState } from '@shotgun/api-client';

export function useConnectivityState(): {
  readonly connectivityState: ConnectivityState;
  readonly isOffline: boolean;
} {
  const [connectivityState, setConnectivityState] = useState<ConnectivityState>(() => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return 'OFFLINE';
    }
    return 'ONLINE';
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setConnectivityState('ONLINE');
    const handleOffline = () => setConnectivityState('OFFLINE');

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return {
    connectivityState,
    isOffline: connectivityState === 'OFFLINE',
  };
}
