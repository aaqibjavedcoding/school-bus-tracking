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
    <div className={`flex flex-col items-center justify-center p-6 ${className}`}>
      <div className="text-center max-w-md">
        <div className="text-4xl mb-3">{icon}</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-4">{message}</p>

        {error.status === 422 && error.details != null && typeof error.details === 'object' && (
          <ValidationErrors details={error.details as Record<string, string[]>} />
        )}

        <div className="flex gap-3 justify-center">
          {action === 'retry' && onRetry && (
            <button
              onClick={onRetry}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
              Try Again
            </button>
          )}
          {action === 'login' && onLogin && (
            <button
              onClick={onLogin}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
            >
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
    <div className="text-left bg-red-50 rounded p-3 mb-4">
      <ul className="text-sm text-red-700 space-y-1">
        {entries.map(([field, messages]) => (
          <li key={field}>
            <span className="font-medium">{field}:</span>{' '}
            {Array.isArray(messages) ? messages.join(', ') : String(messages)}
          </li>
        ))}
      </ul>
    </div>
  );
}
