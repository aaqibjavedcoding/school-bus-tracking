'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '../../components/ui';
import { useAuth } from './AuthProvider';

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'anonymous') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status === 'loading' || status === 'anonymous') {
    return (
      <div className="page">
        <Skeleton lines={8} />
      </div>
    );
  }

  return <>{children}</>;
};
