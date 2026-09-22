'use client';

import React, { useState } from 'react';
import { Input, type InputProps } from './primitives';

/**
 * A password (or PIN) input with a show/hide toggle.
 *
 * The button and the `type` it controls live in one component on purpose: the
 * icon used to be hand-wired per form, which is how a field ends up showing an
 * eye that does nothing, or an eye that flips a `type` the field no longer
 * reads. Here the toggle is the only thing that decides `type`, so the icon and
 * the input can never disagree, and every secret field in the console behaves
 * the same way.
 *
 * `aria-label` says which state the *next* press produces (screen readers read
 * controls, not the current text), and the button is never a form submit —
 * `type="button"` keeps an eye-click from saving a half-filled form.
 */

export const PasswordInput = React.forwardRef<HTMLInputElement, Omit<InputProps, 'type'>>(
  ({ ...props }, ref) => {
    const [revealed, setRevealed] = useState(false);
    return (
      <div className="password-input-wrapper">
        <Input
          {...props}
          ref={ref}
          // `type` is derived from the toggle and cannot be supplied: a caller
          // must not be able to opt a secret out of the mask.
          type={revealed ? 'text' : 'password'}
        />
        <button
          type="button"
          className="password-toggle-btn"
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = 'PasswordInput';

/** Line-art eye / crossed eye, sized to sit inside a 40px input. */
function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}
