import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@school-bus-tracking/shared-types';
import { CurrentUser, Roles } from '../../common/decorators';
import { AuthenticatedRequestUser, JwtAuthGuard, RolesGuard } from '../../common/guards';

/**
 * Non-sensitive projection returned by `/auth-test/me` — the verified token
 * claims only. No email, name, or credential material is ever included.
 */
export interface AuthTestMeResponse {
  user: AuthenticatedRequestUser;
}

/** Response of the role-restricted verification endpoints. */
export interface AuthTestRoleResponse {
  message: string;
  role: UserRole;
}

export const ADMIN_ONLY_MESSAGE = 'Authenticated as school admin';
export const STAFF_ONLY_MESSAGE = 'Authenticated as operations staff';

/**
 * Small protected endpoint set for verifying the Phase 2 auth guards:
 *
 * | Endpoint                | Protection                        | Expected results                                  |
 * | ----------------------- | --------------------------------- | ------------------------------------------------- |
 * | `GET /auth-test/me`     | `JwtAuthGuard`                    | valid token → 200; missing/invalid token → 401    |
 * | `GET /auth-test/admin-only` | `JwtAuthGuard` + `@Roles(SCHOOL_ADMIN)` | allowed role → 200; other roles → 403     |
 * | `GET /auth-test/staff-only` | `JwtAuthGuard` + `@Roles(SCHOOL_ADMIN, DRIVER, CONDUCTOR)` | multi-role check → 200 / 403 |
 */
@Controller('auth-test')
export class AuthTestController {
  /**
   * `GET /api/v1/auth-test/me`
   *
   * Any authenticated request succeeds; the response echoes only the token
   * claims (`id`, `school_id`, `role`) so nothing sensitive is exposed.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentUser() user: AuthenticatedRequestUser): AuthTestMeResponse {
    return { user };
  }

  /**
   * `GET /api/v1/auth-test/admin-only`
   *
   * Requires the `SCHOOL_ADMIN` role: allowed role succeeds, every other
   * authenticated role is rejected with `403`.
   */
  @Get('admin-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SCHOOL_ADMIN)
  getAdminOnly(@CurrentUser('role') role: UserRole): AuthTestRoleResponse {
    return { message: ADMIN_ONLY_MESSAGE, role };
  }

  /**
   * `GET /api/v1/auth-test/staff-only`
   *
   * Multi-role check: `SCHOOL_ADMIN`, `DRIVER`, and `CONDUCTOR` succeed;
   * e.g. `PARENT` is rejected with `403`.
   */
  @Get('staff-only')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.SCHOOL_ADMIN, UserRole.DRIVER, UserRole.CONDUCTOR)
  getStaffOnly(@CurrentUser('role') role: UserRole): AuthTestRoleResponse {
    return { message: STAFF_ONLY_MESSAGE, role };
  }
}
