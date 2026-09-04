/**
 * Endpoint definitions for the `schools` module.
 *
 * Each entry declares what the Nest controller used to express with
 * decorators — authentication, roles, rate-limit policy, success status and
 * the body/query DTOs — plus the handler itself. `route.ts` files under
 * `src/app/api/v1` re-export these as App Router verb handlers.
 */
import { HttpStatus, parseUuidParam, validateDto } from '../framework';
import { container } from '../container';
import type { EndpointDefinition } from '../http/route-runtime';
import { SchoolOnboardingResponse, UserRole } from '@school-bus-tracking/shared-types';
import { SchoolsService } from '../modules/schools/schools.service';
import { OnboardSchoolDto } from '../modules/schools/dto/onboard-school.dto';

/** `POST /api/v1/schools` */
export const postSchools: EndpointDefinition<OnboardSchoolDto> = {
  roles: [UserRole.SUPER_ADMIN],
  status: HttpStatus.CREATED,
  bodyType: OnboardSchoolDto,
  handler: async ({ body }) => {
    const dto = body;
    return container().schools().onboard(dto);
  },};
