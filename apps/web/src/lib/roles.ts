import { UserRole } from '@school-bus-tracking/shared-types';

export interface NavItem {
  href: string;
  label: string;
  icon:
    | 'home'
    | 'users'
    | 'bus'
    | 'route'
    | 'staff'
    | 'assign'
    | 'trip'
    | 'map'
    | 'check'
    | 'child'
    | 'bell'
    | 'school'
    | 'tag'
    | 'doc'
    | 'alert';
}

/**
 * Landing page after login / refresh for each role.
 *
 * The platform SUPER_ADMIN is not a school user: it lands on the platform
 * console (`/admin`), while school roles land in their tenant workspace.
 */
export function homePath(role: UserRole): string {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return '/admin';
    case UserRole.DRIVER:
    case UserRole.CONDUCTOR:
      return '/crew';
    case UserRole.PARENT:
      return '/parent';
    default:
      return '/';
  }
}

export function navItemsForRole(role: UserRole): NavItem[] {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      return [
        { href: '/admin', label: 'Overview', icon: 'home' },
        { href: '/admin/schools', label: 'Schools', icon: 'school' },
        { href: '/admin/subscriptions', label: 'Subscriptions', icon: 'tag' },
        { href: '/admin/plans', label: 'Plans', icon: 'tag' },
      ];
    case UserRole.SCHOOL_ADMIN:
      return [
        { href: '/', label: 'Dashboard', icon: 'home' },
        { href: '/students', label: 'Students', icon: 'users' },
        { href: '/buses', label: 'Buses', icon: 'bus' },
        { href: '/routes', label: 'Routes', icon: 'route' },
        { href: '/staff', label: 'Drivers & conductors', icon: 'staff' },
        { href: '/assignments', label: 'Assignments', icon: 'assign' },
        { href: '/documents', label: 'Documents', icon: 'doc' },
        { href: '/emergencies', label: 'Emergencies', icon: 'alert' },
        { href: '/trips', label: 'Trips', icon: 'trip' },
        { href: '/tracking', label: 'Live tracking', icon: 'map' },
        { href: '/attendance', label: 'Attendance', icon: 'check' },
      ];
    case UserRole.DRIVER:
    case UserRole.CONDUCTOR:
      return [
        { href: '/crew', label: "Today's trip", icon: 'trip' },
        { href: '/tracking', label: 'Live map', icon: 'map' },
      ];
    case UserRole.PARENT:
      return [
        { href: '/parent', label: 'Dashboard', icon: 'home' },
        { href: '/parent/children', label: 'My children', icon: 'child' },
        { href: '/parent/tracking', label: 'Track bus', icon: 'map' },
        { href: '/parent/notifications', label: 'Notifications', icon: 'bell' },
      ];
    default:
      return [];
  }
}

/**
 * Detail screens that are reachable from a nav section but do not live under
 * its href.
 *
 * The sidebar only lists section landing pages, so a guard built from the nav
 * alone would bounce a school admin away from perfectly legitimate deep links
 * (for example the crew document screens opened from "Drivers & conductors").
 * These prefixes are granted in addition to the nav hrefs.
 */
const EXTRA_ALLOWED_PREFIXES: Partial<Record<UserRole, string[]>> = {
  [UserRole.SCHOOL_ADMIN]: ['/drivers', '/conductors'],
  [UserRole.PARENT]: ['/children'],
};

/**
 * Frontend route guard. Mirrors the backend role enforcement so a school user
 * never even renders a platform page (and vice versa); the API is the real
 * boundary and would return 401/403 regardless.
 */
export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (pathname === '/login') return true;

  // The platform console belongs exclusively to the SUPER_ADMIN.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return role === UserRole.SUPER_ADMIN;
  }
  // School tenants must never see platform pages; the platform admin never
  // lands inside a school workspace.
  if (role === UserRole.SUPER_ADMIN) {
    return false;
  }

  const allowed = new Set(navItemsForRole(role).map((item) => item.href));
  for (const prefix of EXTRA_ALLOWED_PREFIXES[role] ?? []) {
    allowed.add(prefix);
  }

  if (pathname === '/') {
    return allowed.has('/') || role === UserRole.SCHOOL_ADMIN;
  }
  for (const href of allowed) {
    if (href === '/admin') continue;
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      return true;
    }
  }
  return false;
}
