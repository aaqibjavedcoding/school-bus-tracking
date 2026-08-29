// Register the expo-task-manager executor in *every* JS context — including
// a cold headless relaunch where React never mounts (background GPS while the
// app is killed / suspended). Must stay above all other imports.
import '../src/gps/background-task';

import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@school-bus-tracking/design-tokens';
import { AuthProvider } from '../src/auth/auth-context';
import { setSessionSideEffects } from '../src/auth/global-session';
import { disconnectAllSockets } from '../src/services/sockets';
import { getGpsTracker } from '../src/gps/registry';
import { ToastProvider } from '../src/components/Toast';

// Signing out (or an expired session) must take the realtime sockets and the
// driver's GPS sharing down with it — no ghost streams after logout.
setSessionSideEffects({
  onSignedOut: () => {
    void Promise.resolve(getGpsTracker().stop()).catch(() => undefined);
    disconnectAllSockets();
  },
});

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.neutral[900] },
            headerTintColor: '#ffffff',
            headerTitleStyle: { fontWeight: 'bold' },
            headerBackTitle: 'Back',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(authenticated)" options={{ headerShown: false }} />
        </Stack>
      </ToastProvider>
    </AuthProvider>
  );
}
