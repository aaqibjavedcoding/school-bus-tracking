'use client';

import React from 'react';

/**
 * Displays API errors with appropriate messaging and actions.
 *
 * Handles:
 * - 401: Session expired → redirect to login
 * - 403: Forbidden → clear message
 * - 404: Not found → clear message
 * - 409: Conflict → retry or clear message
 * - 422: Validation → field-level errors
 * - 429: Rate limited → retry after delay
 * - 500: Server error → retry
 * - Network failure → retry
 */

export interface ApiError {
  status?: number;
  code?: string;
  message: string;
  details?: unknown;
}

interface ApiErrorDisplayProps {
  error: ApiError;
  onRetry?: () => void;
  onLogin?: () => void;
  className?: string;
}

export function ApiErrorDisplay({
  error,
  onRetry,
  onLogin,
  className = '',
}: ApiErrorDisplayProps) {
  const { icon, title, message, action } = getErrorDisplay(error);

  return (
    <div className={`error-box ${className}`} style={{ textAlign: 'center', padding: '1.5rem' }}>
      <div style={{ maxWidth: '28rem', margin: '0 auto' }}>
        <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>{icon}</div>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>{title}</h3>
        <p className="muted" style={{ marginBottom: '1rem' }}>{message}</p>

        {error.status === 422 && error.details != null && typeof error.details === 'object' && (
          <ValidationErrors details={error.details as Record<string, string[]>} />
        )}

        <div className="row" style={{ justifyContent: 'center', gap: '0.75rem' }}>
          {action === 'retry' && onRetry && (
            <button onClick={onRetry} className="btn btn-primary">
              Try Again
            </button>
          )}
          {action === 'login' && onLogin && (
            <button onClick={onLogin} className="btn btn-primary">
              Log In Again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function getErrorDisplay(error: ApiError): {
  icon: string;
  title: string;
  message: string;
  action: 'retry' | 'login' | 'none';
} {
  const status = error.status;

  if (!status) {
    return {
      icon: '📡',
      title: 'Network Error',
      message: 'Unable to connect to the server. Please check your internet connection and try again.',
      action: 'retry',
    };
  }

  switch (status) {
    case 401:
      return {
        icon: '🔐',
        title: 'Session Expired',
        message: 'Your session has expired. Please log in again to continue.',
        action: 'login',
      };
    case 403:
      return {
        icon: '🚫',
        title: 'Access Denied',
        message: 'You don\'t have permission to perform this action. If you believe this is an error, please contact your administrator.',
        action: 'none',
      };
    case 404:
      return {
        icon: '🔍',
        title: 'Not Found',
        message: error.message || 'The requested resource was not found.',
        action: 'none',
      };
    case 409:
      return {
        icon: '⚠️',
        title: 'Conflict',
        message: error.message || 'This action conflicts with the current state. Please refresh and try again.',
        action: 'retry',
      };
    case 422:
      return {
        icon: '📝',
        title: 'Validation Error',
        message: error.message || 'Please check the form for errors.',
        action: 'none',
      };
    case 429:
      return {
        icon: '⏳',
        title: 'Too Many Requests',
        message: 'You\'ve made too many requests. Please wait a moment and try again.',
        action: 'retry',
      };
    case 500:
    case 502:
    case 503:
      return {
        icon: '🔧',
        title: 'Server Error',
        message: 'Something went wrong on our end. Please try again in a moment.',
        action: 'retry',
      };
    default:
      return {
        icon: '❌',
        title: `Error ${status}`,
        message: error.message || 'An unexpected error occurred.',
        action: 'retry',
      };
  }
}

function ValidationErrors({ details }: { details: unknown }) {
  if (!details || typeof details !== 'object') return null;

  const errors = details as Record<string, string[]>;
  const entries = Object.entries(errors);

  if (entries.length === 0) return null;

  return (
    <div style={{
      textAlign: 'left',
      background: 'var(--color-danger-soft)',
      borderRadius: 'var(--radius-sm)',
      padding: '0.75rem',
      marginBottom: '1rem',
    }}>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: '0.875rem', color: '#991b1b' }}>
        {entries.map(([field, messages]) => (
          <li key={field} style={{ marginBottom: '0.25rem' }}>
            <span style={{ fontWeight: 600 }}>{field}:</span>{' '}
            {Array.isArray(messages) ? messages.join(', ') : String(messages)}
          </li>
        ))}
      </ul>
    </div>
  );
}
