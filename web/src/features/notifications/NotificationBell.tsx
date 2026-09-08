'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { UserRole } from '@school-bus-tracking/shared-types';
import { useAuth } from '../auth/AuthProvider';

/**
 * Notification bell for the top bar (parents only).
 *
 * The realtime half of this bell lives in `ParentNotificationBell`, loaded
 * lazily and only when the signed-in session is actually a parent. School
 * admin / crew / driver / staff sessions render nothing here and never
 * download the `/notifications` socket stack, which used to be part of every
 * authenticated page's first load because the bell mounted the hook
 * unconditionally.
 *
 * `ssr: false` keeps the socket out of the server-rendered HTML too; the
 * parent bell appears as soon as hydration finishes, exactly when its data
 * (unread count via REST) would have arrived anyway.
 */
const ParentBell = dynamic(
  () => import('./ParentNotificationBell').then((module) => module.ParentNotificationBell),
  {
    ssr: false,
    loading: () => null,
  },
);

export const NotificationBell: React.FC = () => {
  const { user } = useAuth();
  const isParent = user?.role === UserRole.PARENT;

  // The bell is parents-only; non-parent roles (e.g. admin/crew) must not
  // hit the parent-scoped notification endpoint, which would return 403.
  if (!isParent) return null;

  return <ParentBell />;
};
