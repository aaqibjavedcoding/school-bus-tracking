import React from 'react';
import { Stack } from 'expo-router';
import { UserRole } from '@school-bus-tracking/shared-types';
import { RoleGuard } from '../../../src/components/RoleGuard';

/**
 * Parent shell: the tab bar mirrors the Parent Portal surfaces (home, live
 * bus, alerts); child detail is a stack screen underneath.
 */
export default function ParentLayout() {
  return (
    <RoleGuard roles={[UserRole.PARENT]}>
      <Stack>
        <Stack.Screen name="tabs" options={{ headerShown: false }} />
        <Stack.Screen
          name="children/[childId]"
          options={{
            title: 'Child',
            headerStyle: { backgroundColor: '#0f172a' },
            headerTintColor: '#ffffff',
          }}
        />
      </Stack>
    </RoleGuard>
  );
}
