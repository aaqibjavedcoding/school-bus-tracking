import React from 'react';
import { Redirect } from 'expo-router';
import { UserRole } from '@school-bus-tracking/shared-types';
import { useAuth } from '../auth/auth-context';
import { homeRouteForUser } from '../auth/role-routing';

/**
 * Per-role group guard. A signed-in ADMIN landing on `/driver/trip/...` is
 * bounced to their own home — the same way the web route guard works. This is
 * presentation: the backend independently enforces roles + tenant + crew
 * authorisation on every request.
 */
export const RoleGuard: React.FC<{ roles: UserRole[]; children: React.ReactNode }> = ({
  roles,
  children,
}) => {
  const { status, user } = useAuth();

  if (status !== 'authenticated') {
    return <Redirect href="/login" />;
  }
  if (!user || !roles.includes(user.role)) {
    return <Redirect href={homeRouteForUser(user) ?? '/login'} />;
  }
  return <>{children}</>;
};
