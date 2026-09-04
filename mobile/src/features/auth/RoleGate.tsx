import React from 'react';
import { Redirect } from 'expo-router';
import { LoadingView } from '../../components';
import { canEnterGroup, homeRoute } from '../../lib/roles';
import { useAuth } from './AuthProvider';

/**
 * Route-group guard for the role-based experiences.
 *
 * Mirrors the backend's role enforcement so a parent never renders crew
 * screens (and vice versa); the API remains the real boundary and answers
 * 401/403 regardless. While the refresh-cookie session is being restored the
 * gate simply holds instead of flashing the login screen.
 */
export const RoleGate: React.FC<{
  group: 'crew' | 'parent' | 'admin';
  children: React.ReactNode;
}> = ({ group, children }) => {
  const { status, user } = useAuth();

  if (status === 'loading') {
    return <LoadingView label="Restoring your session…" />;
  }
  if (status === 'anonymous' || !user) {
    return <Redirect href="/login" />;
  }
  if (!canEnterGroup(user.role, group)) {
    return <Redirect href={homeRoute(user.role)} />;
  }
  return <>{children}</>;
};
