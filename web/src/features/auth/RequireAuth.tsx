'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { homePath } from '../../lib/roles';
import { Skeleton } from '../../components/ui';
import { useAuth } from './AuthProvider';

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  useEffect(() => {
    if (status === 'authenticated' && user && pathname === '/') {
      const target = homePath(user.role);
      if (target !== '/') {
        router.replace(target);
      }
    }
  }, [status, user, pathname, router]);

  if (status === 'loading' || status === 'anonymous') {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }

  return <>{children}</>;
};
