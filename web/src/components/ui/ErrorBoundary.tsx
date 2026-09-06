'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Error boundary for catching and displaying React errors gracefully.
 *
 * Handles:
 * - 500 errors
 * - Network failures
 * - Component render errors
 *
 * Provides:
 * - Retry button
 * - Clear error message
 * - Error details in development
 */

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-box" role="alert">
          <h3>Something went wrong</h3>
          <p className="muted">
            An unexpected error occurred. Please try again.
          </p>
          {process.env.NODE_ENV === 'development' && this.state.error && (
            <pre
              style={{
                fontSize: '0.75rem',
                color: 'var(--color-danger)',
                background: 'var(--color-danger-soft)',
                padding: '0.75rem',
                borderRadius: 'var(--radius-sm)',
                marginTop: '0.75rem',
                overflow: 'auto',
                maxWidth: '100%',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button onClick={this.handleRetry} className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
