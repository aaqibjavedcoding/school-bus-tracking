import { HttpException, HttpStatus } from '@nestjs/common';
import {
  PLAN_LIMIT_REACHED_CODE,
  PlanLimitReachedDetails,
  PlanLimitResource,
} from '@school-bus-tracking/shared-types';

const NOUNS: Record<
  PlanLimitResource,
  { plural: string; singular: string; title: string }
> = {
  [PlanLimitResource.STUDENTS]: {
    plural: 'students',
    singular: 'student',
    title: 'Student',
  },
  [PlanLimitResource.BUSES]: { plural: 'buses', singular: 'bus', title: 'Bus' },
  [PlanLimitResource.ROUTES]: { plural: 'routes', singular: 'route', title: 'Route' },
  [PlanLimitResource.STOPS]: { plural: 'stops', singular: 'stop', title: 'Stop' },
  [PlanLimitResource.DRIVERS]: { plural: 'drivers', singular: 'driver', title: 'Driver' },
  [PlanLimitResource.CONDUCTORS]: {
    plural: 'conductors',
    singular: 'conductor',
    title: 'Conductor',
  },
  [PlanLimitResource.STAFF]: {
    plural: 'staff',
    singular: 'staff member',
    title: 'Staff',
  },
  [PlanLimitResource.PARENTS]: {
    plural: 'parents/guardians',
    singular: 'parent/guardian',
    title: 'Parent/Guardian',
  },
  [PlanLimitResource.TRIPS]: { plural: 'trips', singular: 'trip', title: 'Trip' },
};

export function planLimitReachedMessage(resource: PlanLimitResource, limit: number): string {
  const noun = NOUNS[resource];
  return `You've reached your plan limit of ${limit} ${noun.plural}. Please upgrade your plan or remove an existing ${noun.singular} to add another.`;
}

/**
 * Plan-limit violation. Always a 409 with `PLAN_LIMIT_REACHED` — never a 500.
 */
export class PlanLimitReachedException extends HttpException {
  constructor(resource: PlanLimitResource, limit: number, usage: number) {
    const message = planLimitReachedMessage(resource, limit);
    const details: PlanLimitReachedDetails = { resource, limit, usage };
    super(
      {
        statusCode: HttpStatus.CONFLICT,
        error: PLAN_LIMIT_REACHED_CODE,
        message,
        details,
      },
      HttpStatus.CONFLICT,
    );
  }
}
