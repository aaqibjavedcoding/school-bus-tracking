'use client';

import React from 'react';
import { AuthProvider } from '../features/auth/AuthProvider';
import { ToastProvider } from './ui';

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <AuthProvider>
    <ToastProvider>{children}</ToastProvider>
  </AuthProvider>
);
