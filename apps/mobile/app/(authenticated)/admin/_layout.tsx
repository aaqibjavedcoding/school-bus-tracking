import React from 'react';
import { Stack } from 'expo-router';
import { UserRole } from '@school-bus-tracking/shared-types';
import { RoleGuard } from '../../../src/components/RoleGuard';

export default function AdminLayout() {
  return (
    <RoleGuard roles={[UserRole.SCHOOL_ADMIN]}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'School admin' }} />
        <Stack.Screen name="students" options={{ title: 'Students', headerBackVisible: false }} />
        <Stack.Screen name="students/[id]" options={{ title: 'Student' }} />
        <Stack.Screen name="parents" options={{ title: 'Parents' }} />
        <Stack.Screen name="parents/[id]" options={{ title: 'Parent' }} />
        <Stack.Screen name="drivers" options={{ title: 'Drivers' }} />
        <Stack.Screen name="drivers/[id]" options={{ title: 'Driver' }} />
        <Stack.Screen name="conductors" options={{ title: 'Conductors' }} />
        <Stack.Screen name="conductors/[id]" options={{ title: 'Conductor' }} />
        <Stack.Screen name="buses" options={{ title: 'Buses' }} />
        <Stack.Screen name="buses/[id]" options={{ title: 'Bus' }} />
        <Stack.Screen name="routes" options={{ title: 'Routes' }} />
        <Stack.Screen name="routes/[id]" options={{ title: 'Route' }} />
        <Stack.Screen name="assignments" options={{ title: 'Assignments' }} />
        <Stack.Screen name="trips" options={{ title: 'Trips' }} />
        <Stack.Screen name="trips/[id]" options={{ title: 'Trip' }} />
        <Stack.Screen name="monitoring" options={{ title: 'Live monitoring' }} />
        <Stack.Screen name="monitoring/[tripId]" options={{ title: 'Live trip' }} />
      </Stack>
    </RoleGuard>
  );
}
