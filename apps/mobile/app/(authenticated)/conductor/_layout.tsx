import React from 'react';
import { Stack } from 'expo-router';
import { UserRole } from '@school-bus-tracking/shared-types';
import { RoleGuard } from '../../../src/components/RoleGuard';

export default function ConductorLayout() {
  return (
    <RoleGuard roles={[UserRole.CONDUCTOR]}>
      <Stack>
        <Stack.Screen name="index" options={{ title: 'Conductor' }} />
        <Stack.Screen name="trip/[tripId]" options={{ title: 'Today’s trip' }} />
      </Stack>
    </RoleGuard>
  );
}
