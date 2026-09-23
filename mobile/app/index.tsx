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
  const router = useRouter();
  const t = useTranslation();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading') {
    // The brand name comes from the dictionary (`login.brandName`, a
    // locale-invariant key) — the same single source the login screen reads —
    // rather than a literal repeated here.
    return <LoadingView label={t('login.brandName')} />;
  }
  if (status === 'authenticated' && user) {
    return <Redirect href={homeRoute(user.role)} />;
  }
  return <Redirect href="/login" />;
}
