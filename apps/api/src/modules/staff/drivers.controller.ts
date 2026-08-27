import { Controller } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

/**
 * School-admin driver account endpoints under `/api/v1/drivers`.
 *
 * The subclass only contributes the resource path and the pinned role. The
 * JWT-derived tenant and all request handling are inherited from
 * {@link StaffController}; a driver's role is fixed to `DRIVER` for every
 * operation and can never be supplied or escalated by a client.
 */
@Controller('drivers')
export class DriversController extends StaffController<typeof UserRole.DRIVER> {
  constructor(staffService: StaffService) {
    super(staffService, UserRole.DRIVER);
  }
}
