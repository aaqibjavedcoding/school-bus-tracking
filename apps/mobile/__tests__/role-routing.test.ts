import { UserRole } from '@school-bus-tracking/shared-types';
import { ROLE_HOME_ROUTES, homeRouteForUser, canOpenRoute } from '../src/auth/role-routing';

const user = (role: UserRole) =>
  ({
    id: 'user-1',
    email: 'u@example.com',
    role,
    first_name: 'U',
    last_name: 'X',
  }) as never;

describe('role home routing (Task 23 §B)', () => {
  it('maps every role to the route the (authenticated) tree provides', () => {
    expect(ROLE_HOME_ROUTES[UserRole.SCHOOL_ADMIN]).toBe('/admin');
    expect(ROLE_HOME_ROUTES[UserRole.DRIVER]).toBe('/driver');
    expect(ROLE_HOME_ROUTES[UserRole.CONDUCTOR]).toBe('/conductor');
    expect(ROLE_HOME_ROUTES[UserRole.PARENT]).toBe('/parent');
    // SUPER_ADMIN has no mobile workflow — the info screen, not a broken shell.
    expect(ROLE_HOME_ROUTES[UserRole.SUPER_ADMIN]).toBe('/platform-unsupported');
  });

  it('sends each role to its own home after login', () => {
    expect(homeRouteForUser(user(UserRole.DRIVER))).toBe('/driver');
    expect(homeRouteForUser(user(UserRole.PARENT))).toBe('/parent');
  });

  it('fails closed for an unknown role instead of showing admin UI', () => {
    const rogue = {
      id: 'u',
      email: 'x@y.z',
      first_name: 'X',
      last_name: 'Y',
      role: 'FUTURE_ROLE',
    } as never;
    expect(homeRouteForUser(rogue)).toBe('/platform-unsupported');
  });

  it('has no route for an anonymous user (login screen is the fallback)', () => {
    expect(homeRouteForUser(null)).toBeNull();
  });

  it('canOpenRoute gates role groups and allows shared routes for anyone', () => {
    expect(canOpenRoute(UserRole.DRIVER, 'DRIVER')).toBe(true);
    expect(canOpenRoute(UserRole.PARENT, 'DRIVER')).toBe(false);
    expect(canOpenRoute(null, 'DRIVER')).toBe(false);
    expect(canOpenRoute(null, 'any')).toBe(true);
  });
});
