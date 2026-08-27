import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Roles Guard foundation (Phase 1 placeholder)
 * Note: Authentication and authorization logic will be activated in Phase 2.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(_context: ExecutionContext): boolean {
    // Auth is intentionally disabled in Phase 1
    return true;
  }
}
