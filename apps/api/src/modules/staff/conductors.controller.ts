import { Controller } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * School-admin conductor account endpoints under `/api/v1/conductors`.
 *
 * The subclass only contributes the resource path and the pinned role. The
 * JWT-derived tenant and all request handling are inherited from
 * {@link StaffController}; a conductor's role is fixed to `CONDUCTOR` for
 * every operation and can never be supplied or escalated by a client.
 */
@Controller('conductors')
export class ConductorsController extends StaffController<typeof UserRole.CONDUCTOR> {
  constructor(staffService: StaffService) {
    super(staffService, UserRole.CONDUCTOR);
  }
}
