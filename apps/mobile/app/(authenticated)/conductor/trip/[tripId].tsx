import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { TripWorkspaceScreen } from '../../../../src/features/crew/TripWorkspaceScreen';
import { Screen } from '../../../../src/components/Screen';
import { EmptyState } from '../../../../src/components/Feedback';

export default function ConductorTripScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  if (!tripId) {
    return (
      <Screen>
        <EmptyState title="No trip selected" message="Open a trip from today’s list." />
      </Screen>
    );
  }
  return <TripWorkspaceScreen tripId={tripId} mode="conductor" />;
}
