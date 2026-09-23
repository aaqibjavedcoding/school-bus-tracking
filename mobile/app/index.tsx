import React, { useEffect } from 'react';
import { Redirect, useRouter } from 'expo-router';
import { useAuth } from '../src/features/auth';
import { LoadingView } from '../src/components';
import { useTranslation } from '../src/lib/i18n-provider';
import { homeRoute } from '../src/lib/roles';

/**
 * Entry gate: restores the cookie-backed session, then lands each role on
 * its own experience — crew (driver/conductor), parent, school admin, or the
 * platform-admin notice screen for SUPER_ADMIN (the platform console stays a
 * web surface).
 */
export default function IndexGate() {
  const { status, user } = useAuth();
  const t = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    return <LoadingView label={t('app.name')} />;
  }
  if (status === 'authenticated' && user) {
    return <Redirect href={homeRoute(user.role)} />;
  }
  return <Redirect href="/login" />;
}
