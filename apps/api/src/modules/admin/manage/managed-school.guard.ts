import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_MANAGE_SCHOOLS_REPOSITORY } from './admin-manage.constants';
import {
  MANAGED_SCHOOL_INACTIVE_MESSAGE,
  MANAGED_SCHOOL_NOT_FOUND_MESSAGE,
  MANAGED_SCHOOL_PARAM,
  MANAGED_SCHOOL_REQUEST_PROPERTY,
  type ManagedSchoolContext,
} from './admin-manage.constants';

/**
 * Handlers annotated with this metadata are allowed even while the managed
 * school is deactivated. Session bookkeeping (start / end / current) uses it:
 * a platform operator must be able to open a read-only assisted session on a
 * suspended tenant, exactly like the rest of the platform console.
 */
export const ASSISTED_ALLOW_WHEN_INACTIVE_KEY = 'assistedAllowWhenInactive';
export const AssistedAllowWhenInactive = () => SetMetadata(ASSISTED_ALLOW_WHEN_INACTIVE_KEY, true);

/** Minimal request shape the guard works with. */
interface ManagedSchoolRequest {
  method: string;
  params?: Record<string, string>;
  [MANAGED_SCHOOL_REQUEST_PROPERTY]?: ManagedSchoolContext;
}

/** Repository subset of the `School` model the guard needs. */
export interface ManagedSchoolLookup {
  unscoped(): {
    findOne(options: { where: { id: string }; attributes?: string[] }): Promise<{
      id: string;
      name: string;
      code: string;
      is_active: boolean;
    } | null>;
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves and validates the managed school for an assisted-management route.
 *
 * Runs **after** `JwtAuthGuard` + `RolesGuard`, so it only ever sees an
 * authenticated `SUPER_ADMIN`. The school id comes exclusively from the route
 * parameter — never from the body, query string or any header — and the loaded
 * row is attached to the request as the single managed-school context for the
 * handler chain:
 *
 * - unknown or soft-deleted school → generic `404` (no existence leak beyond
 *   what the platform console already shows);
 * - `PATCH`/`POST`/`PUT`/`DELETE` on a deactivated school → `403`, mirroring
 *   the rule that stops a suspended school's own admins from mutating, unless
 *   the handler opted out with `@AssistedAllowWhenInactive()`;
 * - `GET`/`HEAD` on a deactivated school → allowed (read-only inspection).
 *
 * The guard never mutates the authenticated user: `request.user` keeps the
 * Super Admin identity and the managed school stays a separate property.
 */
@Injectable()
export class ManagedSchoolGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    /**
     * Injected behind a token (the convention of every other module) so the
     * app boots with `DB_AUTO_CONNECT=false` and unit tests can inject stubs.
     */
    @Inject(ADMIN_MANAGE_SCHOOLS_REPOSITORY) private readonly schools: ManagedSchoolLookup,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ManagedSchoolRequest>();
    const schoolId = request.params?.[MANAGED_SCHOOL_PARAM];

    if (!schoolId || !UUID_PATTERN.test(schoolId)) {
      throw new HttpException('School id must be a UUID', HttpStatus.BAD_REQUEST);
    }

    const school = await this.schools
      .unscoped()
      .findOne({ where: { id: schoolId }, attributes: ['id', 'name', 'code', 'is_active'] });

    if (!school) {
      throw new NotFoundException(MANAGED_SCHOOL_NOT_FOUND_MESSAGE);
    }

    const managedSchool: ManagedSchoolContext = {
      id: school.id,
      name: school.name,
      code: school.code,
      is_active: school.is_active,
    };

    if (
      !managedSchool.is_active &&
      !this.isSafeMethod(request.method) &&
      !this.allowsInactive(context)
    ) {
      throw new ForbiddenException(MANAGED_SCHOOL_INACTIVE_MESSAGE);
    }

    request[MANAGED_SCHOOL_REQUEST_PROPERTY] = managedSchool;
    return true;
  }

  private isSafeMethod(method: string): boolean {
    const upper = method.toUpperCase();
    return upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS';
  }

  private allowsInactive(context: ExecutionContext): boolean {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>(ASSISTED_ALLOW_WHEN_INACTIVE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }
}

/** Convenience accessor for handlers that need the guarded context. */
export function getManagedSchool(request: {
  [MANAGED_SCHOOL_REQUEST_PROPERTY]?: ManagedSchoolContext;
}): ManagedSchoolContext {
  const managed = request[MANAGED_SCHOOL_REQUEST_PROPERTY];
  if (!managed) {
    // Unreachable when the guard ran; a loud failure beats a silent fallback
    // to an unscoped operation.
    throw new ForbiddenException(MANAGED_SCHOOL_NOT_FOUND_MESSAGE);
  }
  return managed;
}
