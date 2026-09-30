import { UserRole, type AuthenticatedUser, type TripResponse } from '@school-bus-tracking/shared-types';

/** Whether this authenticated user is assigned crew for the trip. */
export function canActAsCrewOnTrip(
  user: Pick<AuthenticatedUser, 'id' | 'role'> | null | undefined,
  trip: Pick<TripResponse, 'driver_id' | 'conductor_id'>,
): boolean {
  if (!user || (user.role !== UserRole.DRIVER && user.role !== UserRole.CONDUCTOR)) return false;
  return user.role === UserRole.DRIVER ? trip.driver_id === user.id : trip.conductor_id === user.id;
}
