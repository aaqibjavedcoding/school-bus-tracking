'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { fullName, initials, roleLabel } from '../../lib/format';
import { activeNavHref, navItemsForRole } from '../../lib/roles';
import { useAuth } from '../../features/auth/AuthProvider';
import { ManagedSchoolBanner, useManagedSchool } from '../../features/managed';
import { clearManagedSchool } from '../../features/managed/managed-school-store';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { EmergencyAlarmBell } from '../../features/emergencies/EmergencyAlarmBell';
import { Button } from '../ui';
import { NavIcon } from './icons';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, logout } = useAuth();
  const { managed } = useManagedSchool();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const managingSchool = Boolean(managed);
  const items = useMemo(
    () => (user ? navItemsForRole(user.role, managingSchool) : []),
    [user, managingSchool],
  );
  // Only the deepest matching section is highlighted, so `/admin/schools`
  // never lights up the `/admin` dashboard entry as well.
  const activeHref = useMemo(() => activeNavHref(items, pathname), [items, pathname]);

  if (!user) return <>{children}</>;

  return (
    <div className="app-shell">
      {open ? (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      ) : null}
      <aside className={`sidebar ${open ? 'open' : ''}`.trim()} aria-label="Primary">
        <div className="sidebar-brand">
          <span className="brand-mark">SBT</span>
          <div className="brand-copy">
            <h1>School Bus Tracking</h1>
            <p>Live fleet operations</p>
          </div>
        </div>
        <nav className="sidebar-nav">
          {items.map((item) => {
            const active = item.href === activeHref;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-link ${active ? 'active' : ''}`.trim()}
                aria-current={active ? 'page' : undefined}
                onClick={() => setOpen(false)}
              >
                <NavIcon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-chip" style={{ marginBottom: '0.85rem' }}>
            <span className="avatar">{initials(user)}</span>
            <div>
              <strong>{fullName(user)}</strong>
              <span>{roleLabel(user.role)}</span>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() => {
              // Leaving the platform also leaves the managed-school context.
              clearManagedSchool();
              void logout();
            }}
            style={{ width: '100%' }}
          >
            Sign out
          </Button>
        </div>
      </aside>
      <div className="app-main">
        {managingSchool ? <ManagedSchoolBanner /> : null}
        <header className="topbar">
          <button
            type="button"
            className="menu-toggle"
            aria-label="Open navigation"
            onClick={() => setOpen(true)}
          >
            Menu
          </button>
          <div className="topbar-title">
            {items.find((item) => item.href === activeHref)?.label ?? 'Workspace'}
          </div>
          <div className="topbar-end">
            {/* Parents see their notification bell; a school admin sees the
                emergency alarm control, which sounds a siren the moment a crew
                member presses SOS — on any screen, not just the console. */}
            <EmergencyAlarmBell />
            <NotificationBell />
            <div className="muted" style={{ fontSize: '0.8rem' }}>
              {fullName(user)}
            </div>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
};
