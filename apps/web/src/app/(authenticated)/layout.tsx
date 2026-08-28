'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useEffect } from 'react';
import { AppShell } from '../../components/layout/AppShell';
import { RequireAuth } from '../../features/auth/RequireAuth';
import { useAuth } from '../../features/auth/AuthProvider';
import { canAccessPath, homePath } from '../../lib/roles';

export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const { user, status } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (status === 'authenticated' && user && !canAccessPath(user.role, pathname)) {
      router.replace(homePath(user.role));
    }
  }, [status, user, pathname, router]);

  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
