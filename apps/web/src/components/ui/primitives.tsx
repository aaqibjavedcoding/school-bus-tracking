'use client';

import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'md' | 'lg' | 'touch';
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...props
}) => {
  const sizeClass = size === 'lg' ? 'btn-lg' : size === 'touch' ? 'btn-touch' : '';
  return (
    <button
      type={type}
      className={`btn btn-${variant} ${sizeClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
};

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ id, label, hint, error, children }) => (
  <div className="field">
    <label htmlFor={id}>{label}</label>
    {children}
    {hint && !error ? <span className="hint muted">{hint}</span> : null}
    {error ? (
      <span className="field-error" role="alert">
        {error}
      </span>
    ) : null}
  </div>
);

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className = '', error, ...props }, ref) => (
    <input
      ref={ref}
      className={`input ${className}`.trim()}
      aria-invalid={error || undefined}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = '', ...props }, ref) => (
  <textarea ref={ref} className={`textarea ${className}`.trim()} {...props} />
));
Textarea.displayName = 'Textarea';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ options, placeholder, className = '', ...props }, ref) => (
    <select ref={ref} className={`select ${className}`.trim()} {...props}>
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
);
Select.displayName = 'Select';

export type BadgeTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const Badge: React.FC<{ tone?: BadgeTone; children: React.ReactNode }> = ({
  tone = 'neutral',
  children,
}) => (
  <span className={`badge badge-${tone}`}>
    <span className="dot" aria-hidden="true" />
    {children}
  </span>
);

export const Spinner: React.FC<{ label?: string }> = ({ label = 'Loading' }) => (
  <span className="muted" role="status" aria-live="polite">
    {label}…
  </span>
);

export const Card: React.FC<{
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}> = ({ title, description, children, className = '' }) => (
  <section className={`card ${className}`.trim()}>
    {title ? <h2>{title}</h2> : null}
    {description ? (
      <p className="muted" style={{ margin: title ? '0.35rem 0 0.85rem' : '0 0 0.85rem' }}>
        {description}
      </p>
    ) : null}
    {children}
  </section>
);

export const CheckboxRow: React.FC<{
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}> = ({ id, label, hint, checked, onChange }) => (
  <label htmlFor={id} className="checkbox-row">
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
    />
    <span>
      <strong>{label}</strong>
      {hint ? <span className="muted" style={{ fontSize: '0.8rem', display: 'block' }}>{hint}</span> : null}
    </span>
  </label>
);

export const LimitRow: React.FC<{
  id: string;
  label: string;
  unlimited: boolean;
  value: string;
  error?: string;
  onUnlimitedChange: (checked: boolean) => void;
  onValueChange: (value: string) => void;
}> = ({ id, label, unlimited, value, error, onUnlimitedChange, onValueChange }) => (
  <div className="limit-row">
    <label htmlFor={`${id}-unlimited`} className="checkbox-row" style={{ flex: '0 0 auto' }}>
      <input
        id={`${id}-unlimited`}
        type="checkbox"
        checked={unlimited}
        onChange={(event) => onUnlimitedChange(event.target.checked)}
      />
      <strong>{label}</strong>
    </label>
    <div style={{ flex: 1 }}>
      {unlimited ? (
        <span className="muted">Unlimited</span>
      ) : (
        <Input
          id={`${id}-value`}
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          error={Boolean(error)}
          placeholder="e.g. 300"
          style={{ maxWidth: 200 }}
        />
      )}
      {error ? (
        <span className="field-error" role="alert" style={{ fontSize: '0.8rem' }}>
          {error}
        </span>
      ) : null}
    </div>
  </div>
);

export const PageHeader: React.FC<{
  title: string;
  description?: string;
  actions?: React.ReactNode;
}> = ({ title, description, actions }) => (
  <header className="page-header">
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="row">{actions}</div> : null}
  </header>
);
