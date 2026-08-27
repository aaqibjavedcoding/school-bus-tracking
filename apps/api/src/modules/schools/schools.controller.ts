import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { SchoolOnboardingResponse, UserRole } from '@school-bus-tracking/shared-types';
import { Roles } from '../../common/decorators';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { SchoolsService } from './schools.service';
import { OnboardSchoolDto } from './dto/onboard-school.dto';

/**
 * School onboarding endpoints.
 *
 * `POST /api/v1/schools` provisions a new tenant and its initial school admin.
 * It requires an authenticated platform operator (`SUPER_ADMIN`) — ordinary
 * school admins have no role metadata match and are rejected with 403, so no
 * authenticated caller can create arbitrary schools.
 */
@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  /**
   * `POST /api/v1/schools`
   *
   * Creates school + admin atomically (transaction in the service) and
   * returns a clean projection of both records. The created admin can
   * immediately use the existing login flow.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SUPER_ADMIN)
  async onboard(@Body() dto: OnboardSchoolDto): Promise<SchoolOnboardingResponse> {
    return this.schoolsService.onboard(dto);
  }
}
