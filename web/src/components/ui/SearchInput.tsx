'use client';

import React from 'react';
import { Input } from './primitives';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** True while a debounced search is pending; shows an inline spinner. */
  searching?: boolean;
  className?: string;
}

/**
 * Standard toolbar search field: debounce is handled by `usePagedResource`,
 * this component only renders a clear (×) button and a pending indicator so
 * every list screen exposes the same clear/empty/loading affordances.
 */
export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  placeholder = 'Search…',
  searching = false,
  className = 'search',
}) => {
  const hasValue = value.length > 0;
  return (
    <span className={`search-input ${className}`.trim()}>
      <Input
        value={value}
        placeholder={placeholder}
        aria-label="Search"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onChange('');
        }}
      />
      {searching ? <span className="search-input__spinner" aria-hidden /> : null}
      {hasValue && !searching ? (
        <button
          type="button"
          className="search-input__clear"
          aria-label="Clear search"
          onClick={() => onChange('')}
        >
          ×
        </button>
      ) : null}
    </span>
  );
};
