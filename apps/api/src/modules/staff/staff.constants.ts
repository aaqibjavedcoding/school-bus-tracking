import { UserRole } from '@school-bus-tracking/shared-types';
import type { StaffRole } from '@school-bus-tracking/shared-types';

/**
 * Injection token and user-facing messages for the driver/conductor staff
 * module.
 *
 * Model classes are injected behind a token (instead of
 * `SequelizeModule.forFeature`) so the application still boots while
 * `DB_AUTO_CONNECT=false` and unit tests can substitute in-memory stubs — the
 * same pattern used by AuthModule, StudentsModule, ParentsModule and
 * BusesModule.
 */
export const STAFF_REPOSITORY = 'STAFF_REPOSITORY';

/** The two roles this module manages; never accepted from a client. */
export const STAFF_ROLES: readonly StaffRole[] = [UserRole.DRIVER, UserRole.CONDUCTOR] as const;

type StaffMessageSet = {
  notFound: string;
  deleted: string;
};

/**
 * Role-specific messages. The staff role is always server-owned (the
 * controller pins it per resource), so these lookups never depend on client
 * input.
 */
const STAFF_MESSAGES: Record<StaffRole, StaffMessageSet> = {
  [UserRole.DRIVER]: {
    notFound: 'Driver account not found',
    deleted: 'Driver account deleted successfully',
  },
  [UserRole.CONDUCTOR]: {
    notFound: 'Conductor account not found',
    deleted: 'Conductor account deleted successfully',
  },
};

/** Generic not-found message; also covers another tenant or the other staff role. */
export function staffNotFoundMessage(role: StaffRole): string {
  return STAFF_MESSAGES[role].notFound;
}

/** Confirmation returned after a staff account is soft-deleted. */
export function staffDeletedMessage(role: StaffRole): string {
  return STAFF_MESSAGES[role].deleted;
}

/**
 * Email is unique across all users within a school (admins, drivers,
 * conductors and parents share one tenant-scoped uniqueness index).
 */
export const STAFF_EMAIL_TAKEN_MESSAGE = 'A user with this email already exists in this school';
