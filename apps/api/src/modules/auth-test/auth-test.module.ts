import { Module } from '@nestjs/common';
import { AuthTestController } from './auth-test.controller';

/**
 * Minimal module exposing the protected verification endpoints for the
 * Phase 2 auth guards.
 *
 * It declares no providers of its own: `JwtAuthGuard` resolves the globally
 * registered `JwtService` (see `AuthModule`), so the existing JWT
 * configuration is reused instead of duplicated.
 */
@Module({
  controllers: [AuthTestController],
})
export class AuthTestModule {}
