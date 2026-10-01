'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { APP_CONFIG } from '@school-bus-tracking/config';
import type { AuthenticatedUser } from '@school-bus-tracking/shared-types';
import { fullName, roleLabel } from '../../lib/format';
import { activeNavHref, navItemsForRole } from '../../lib/roles';
import { useAuth } from '../../features/auth/AuthProvider';
import { ManagedSchoolBanner, useManagedSchool } from '../../features/managed';
import { clearManagedSchool } from '../../features/managed/managed-school-store';
import { NotificationBell } from '../../features/notifications/NotificationBell';
import { EmergencyAlarmBell } from '../../features/emergencies/EmergencyAlarmBell';
import { Button } from '../ui';
import { NavIcon } from './icons';
import { avatarPresentation } from '../../features/account/profile-photo';
import { useProfilePhoto } from '../../features/account/useProfilePhoto';

/**
 * The sidebar avatar: the account's own photo, or its initials.
 *
 * Both halves are shared with `/account` — the resolution is the pure
 * `avatarPresentation`, the bytes come from the same authenticated
 * `useProfilePhoto` hook — so the two surfaces can never disagree about what
 * the current photo is.
 */
const UserAvatar: React.FC<{ user: AuthenticatedUser }> = ({ user }) => {
  const photoUrl = useProfilePhoto(user);
  const avatar = avatarPresentation(user, photoUrl);

  if (avatar.kind === 'photo') {
    // A plain <img>, not next/image: an authenticated object URL created in
    // the browser, which the image optimizer cannot fetch.
    return (
      <img
        src={avatar.src}
        alt=""
        width={36}
        height={36}
        className="avatar"
        style={{ objectFit: 'cover' }}
      />
    );
  }
  return <span className="avatar">{avatar.initials}</span>;
};

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
  // Roles that cannot own a photo have no `/account` entry in their nav, and
  // the layout guard would bounce them straight back; their chip therefore
  // links nowhere new.
  const accountHref = items.some((item) => item.href === '/account') ? '/account' : null;

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
          <span className="brand-mark">
            <Image
              src="/kidbus-mark.svg"
              alt=""
              width={42}
              height={42}
              style={{ width: 'auto', height: 'auto' }}
              priority
            />
          </span>
          <div className="brand-copy">
            <h1>{APP_CONFIG.appName}</h1>
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
          {/**
           * The chip is the console's one persistent view of "who am I",
           * so it shows the photo the moment the session carries a key —
           * including right after an upload, because `/account` pushes the
           * confirmed key into the session rather than waiting for a
           * refresh. Initials remain the fallback for everyone without a
           * photo (and whenever the fetch fails), and the whole chip is a
           * link to `/account`, which is where both are changed.
           */}
          <Link
            href={accountHref ?? '/account'}
            className="user-chip"
            style={{ marginBottom: '0.85rem', color: 'inherit', textDecoration: 'none' }}
            aria-label="My account"
            onClick={() => setOpen(false)}
          >
            <UserAvatar user={user} />
            <div>
              <strong>{fullName(user)}</strong>
              <span>{roleLabel(user.role)}</span>
            </div>
          </Link>
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
