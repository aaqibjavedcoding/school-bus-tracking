// Side-effect import: registers the crew background-location task at app
// entry so `expo-location` can deliver fixes even when the app was relaunched
// headlessly by the OS.
import '../src/features/crew/location-task';

import React from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { colors } from '@school-bus-tracking/design-tokens';
import { UserRole } from '@school-bus-tracking/shared-types';
import { AuthProvider, useAuth } from '../src/features/auth';
import { NotificationsProvider } from '../src/features/parent/NotificationsProvider';
import { ToastProvider } from '../src/components';

/**
 * Root layout: authentication for everyone, plus the realtime notification
 * centre mounted only for an authenticated PARENT (the `/notifications`
 * socket rooms are parent-private by design).
 */
function RoleProviders({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();
  if (status === 'authenticated' && user?.role === UserRole.PARENT) {
    return <NotificationsProvider>{children}</NotificationsProvider>;
  }
  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RoleProviders>
        <>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.neutral[900] },
              headerTintColor: '#ffffff',
              headerTitleStyle: { fontWeight: 'bold' },
              contentStyle: { backgroundColor: colors.neutral[50] },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="platform" options={{ title: 'Platform admin' }} />
            <Stack.Screen name="(crew)" options={{ headerShown: false }} />
            <Stack.Screen name="(parent)" options={{ headerShown: false }} />
            <Stack.Screen name="(admin)" options={{ headerShown: false }} />
          </Stack>
        </>
        </RoleProviders>
      </ToastProvider>
    </AuthProvider>
  );
}
