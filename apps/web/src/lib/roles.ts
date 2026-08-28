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
    | 'school';
}

export function homePath(role: UserRole): string {
  switch (role) {
    case UserRole.DRIVER:
    case UserRole.CONDUCTOR:
      return '/crew';
    case UserRole.PARENT:
      return '/children';
    default:
      return '/';
  }
}

export function navItemsForRole(role: UserRole): NavItem[] {
  switch (role) {
    case UserRole.SCHOOL_ADMIN:
      return [
        { href: '/', label: 'Dashboard', icon: 'home' },
        { href: '/students', label: 'Students', icon: 'users' },
        { href: '/buses', label: 'Buses', icon: 'bus' },
        { href: '/routes', label: 'Routes', icon: 'route' },
        { href: '/staff', label: 'Drivers & conductors', icon: 'staff' },
        { href: '/assignments', label: 'Assignments', icon: 'assign' },
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
        { href: '/children', label: 'My children', icon: 'child' },
        { href: '/tracking', label: 'Track bus', icon: 'map' },
      ];
    default:
      return [];
  }
}

export function canAccessPath(role: UserRole, pathname: string): boolean {
  if (pathname === '/login') return true;
  const allowed = new Set(navItemsForRole(role).map((item) => item.href));
  if (pathname === '/') {
    return allowed.has('/') || role === UserRole.SCHOOL_ADMIN || role === UserRole.SUPER_ADMIN;
  }
  for (const href of allowed) {
    if (pathname === href || pathname.startsWith(`${href}/`)) {
      return true;
    }
  }
  return false;
}
