import React from 'react';
import { Redirect, Stack } from 'expo-router';
import { useAuth } from '../../src/auth/auth-context';

/**
 * Gate for everything under `(authenticated)`:
 *
 * - not signed in → back to `/login` (deep links cannot bypass it);
 * - signed in → the role's own group layout applies its additional guard.
 *
 * This is presentation only. Real authorisation is the API's
 * `JwtAuthGuard`/`RolesGuard`/tenant scoping on every request.
 */
export default function AuthenticatedLayout() {
  const { status } = useAuth();

  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: '#0f172a' },
        headerTintColor: '#ffffff',
        headerTitleStyle: { fontWeight: 'bold' },
      }}
    >
      <Stack.Screen name="admin" options={{ headerShown: false }} />
      <Stack.Screen name="driver" options={{ headerShown: false }} />
      <Stack.Screen name="conductor" options={{ headerShown: false }} />
      <Stack.Screen name="parent" options={{ headerShown: false }} />
      <Stack.Screen name="platform-unsupported" options={{ title: 'Mobile access' }} />
    </Stack>
  );
}
