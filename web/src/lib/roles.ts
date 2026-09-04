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
    | 'alert'
    | 'chart'
    | 'upload';
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

/** Sidebar shown to the SUPER_ADMIN while an assisted-management session is active. */
export const MANAGED_NAV_ITEMS: NavItem[] = [
  { href: '/students', label: 'Students', icon: 'users' },
  { href: '/parents', label: 'Parents / Guardians', icon: 'child' },
  { href: '/buses', label: 'Buses', icon: 'bus' },
  { href: '/routes', label: 'Routes', icon: 'route' },
  { href: '/staff', label: 'Drivers & conductors', icon: 'staff' },
  { href: '/assignments', label: 'Assignments', icon: 'assign' },
  { href: '/reports', label: 'Reports', icon: 'chart' },
  { href: '/imports', label: 'Import data', icon: 'upload' },
];

export function navItemsForRole(role: UserRole, managedSchoolActive = false): NavItem[] {
  switch (role) {
    case UserRole.SUPER_ADMIN:
      // Inside "Manage Data" the operator works with the school's sections.
      if (managedSchoolActive) {
        return MANAGED_NAV_ITEMS;
      }
      return [
        { href: '/admin', label: 'Dashboard', icon: 'home' },
        { href: '/admin/schools', label: 'Schools', icon: 'school' },
        { href: '/admin/subscriptions', label: 'Subscriptions', icon: 'tag' },
        { href: '/admin/plans', label: 'Plans', icon: 'tag' },
        // Backed by the existing dashboard aggregate endpoint — estimates
        // derived from plan prices, never collected payments.
        { href: '/admin/revenue', label: 'Revenue', icon: 'tag' },
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
        { href: '/reports', label: 'Reports', icon: 'chart' },
        { href: '/imports', label: 'Import data', icon: 'upload' },
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
 * Tenant sections reachable during assisted management.
 *
 * Mirrors the API's assisted-management allowlist 1:1: students (incl. the
 * student detail + guardians screen), parents/guardians, buses, routes (incl.
 * the stop manifest), drivers/conductors, assignments, imports (wizard +
 * history) and reports. Everything else — trips, live tracking, documents,
 * emergencies, attendance, the parent portal — stays blocked; links into those
 * areas are hidden by the managed-aware pages, and a hand-typed URL bounces
 * back to the platform console.
 */
const MANAGED_ALLOWED_PREFIXES = MANAGED_NAV_ITEMS.map((item) => item.href);

/**
 * Frontend route guard. Mirrors the backend role enforcement so a school user
 * never even renders a platform page (and vice versa); the API is the real
 * boundary and would return 401/403 regardless.
 *
 * `managedSchoolActive` opens the school-admin sections listed above to the
 * SUPER_ADMIN for as long as an assisted-management session is active — and
 * only those sections.
 */
export function canAccessPath(role: UserRole, pathname: string, managedSchoolActive = false): boolean {
  if (pathname === '/login') return true;

  // The platform console belongs exclusively to the SUPER_ADMIN.
  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return role === UserRole.SUPER_ADMIN;
  }
  // School tenants must never see platform pages; the platform admin only
  // enters a school workspace through an active assisted-management session,
  // and even then just the allowlisted operational sections.
  if (role === UserRole.SUPER_ADMIN) {
    if (!managedSchoolActive) {
      return false;
    }
    return MANAGED_ALLOWED_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    );
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

/**
 * The nav entry that should be highlighted for `pathname`.
 *
 * Sections whose href is a prefix of another section (e.g. `/admin` and
 * `/admin/schools`) must not both light up, so the *longest* matching href
 * wins. `/` only ever matches itself. Returns null when nothing matches.
 */
export function activeNavHref(items: NavItem[], pathname: string): string | null {
  let best: string | null = null;
  for (const item of items) {
    const matches =
      item.href === '/'
        ? pathname === '/'
        : pathname === item.href || pathname.startsWith(`${item.href}/`);
    if (matches && (best === null || item.href.length > best.length)) {
      best = item.href;
    }
  }
  return best;
}
