import React, { useEffect } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../src/features/auth';
import { LoadingView } from '../src/components';
import { homeRoute } from '../src/lib/roles';

/**
 * Entry gate: restores the cookie-backed session, then lands each role on
 * its own experience — crew (driver/conductor), parent, school admin, or the
 * platform-admin notice screen for SUPER_ADMIN (the platform console stays a
 * web surface).
 */
export default function IndexGate() {
  const { status, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return <LoadingView label="School Bus Tracking" />;
  }
  if (status === 'authenticated' && user) {
    return <Redirect href={homeRoute(user.role)} />;
  }
  return <Redirect href="/login" />;
}
