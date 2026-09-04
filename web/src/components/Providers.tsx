'use client';

import React from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ManagedSchoolProvider } from '../features/managed/ManagedSchoolProvider';
import { ToastProvider } from './ui';

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    <ManagedSchoolProvider>
      <ToastProvider>{children}</ToastProvider>
    </ManagedSchoolProvider>
  </AuthProvider>
);
