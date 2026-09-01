import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CsrfGuard } from './csrf.guard';

/**
 * Browser-security wiring.
 *
 * Registers the CSRF guard globally so every state-changing route is covered
 * by default. CORS, security headers and the refresh-cookie policy are applied
 * in `main.ts` (they are HTTP-adapter concerns, not DI concerns).
 */
@Global()
@Module({
  providers: [{ provide: APP_GUARD, useClass: CsrfGuard }],
})
export class SecurityModule {}
