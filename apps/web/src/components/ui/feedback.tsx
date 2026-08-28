'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button } from './primitives';

interface ToastItem {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'danger';
}

interface ToastContextValue {
  push: (message: string, tone?: ToastItem['tone']) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-viewport" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone === 'info' ? '' : toast.tone}`.trim()}>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) {
    throw new Error('useToast must be used within ToastProvider');
  }
  return value;
}

export const Skeleton: React.FC<{ lines?: number; className?: string }> = ({
  lines = 4,
  className = '',
}) => (
  <div className={className} aria-hidden="true">
    {Array.from({ length: lines }, (_, index) => (
      <div
        key={index}
        className="skeleton skeleton-line"
        style={{ width: `${92 - (index % 3) * 12}%` }}
      />
    ))}
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="empty">
    <h3>{title}</h3>
    <p className="muted">{description}</p>
    {action}
  </div>
);

export const ErrorState: React.FC<{
  title?: string;
  message: string;
  onRetry?: () => void;
}> = ({ title = 'Unable to load', message, onRetry }) => (
  <div className="error-box" role="alert">
    <h3>{title}</h3>
    <p className="muted">{message}</p>
    {onRetry ? (
      <Button variant="secondary" onClick={onRetry}>
        Try again
      </Button>
    ) : null}
  </div>
);

export const Modal: React.FC<{
  title: string;
  description?: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ title, description, open, onClose, children }) => {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="modal-title">{title}</h2>
        {description ? <p className="muted">{description}</p> : null}
        <div style={{ marginTop: '1rem' }}>{children}</div>
      </div>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
}) => (
  <Modal title={title} open={open} onClose={onCancel}>
    <p>{message}</p>
    <div className="modal-actions">
      <Button variant="secondary" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
        {busy ? 'Working…' : confirmLabel}
      </Button>
    </div>
  </Modal>
);

export const Pagination: React.FC<{
  page: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPage: (page: number) => void;
}> = ({ page, totalPages, hasNextPage, hasPreviousPage, onPage }) => (
  <div className="pagination">
    <span>
      Page {page}
      {totalPages > 0 ? ` of ${totalPages}` : ''}
    </span>
    <div className="row">
      <Button variant="secondary" disabled={!hasPreviousPage} onClick={() => onPage(page - 1)}>
        Previous
      </Button>
      <Button variant="secondary" disabled={!hasNextPage} onClick={() => onPage(page + 1)}>
        Next
      </Button>
    </div>
  </div>
);
