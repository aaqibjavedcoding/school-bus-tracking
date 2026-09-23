import React from 'react';

const shared = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
};

export function BrandBusIcon() {
  return (
    <svg viewBox="0 0 32 32" {...shared}>
      <rect x="4" y="6" width="24" height="19" rx="4" />
      <path d="M4 16h24M10 6v10m12-10v10M9 25v2m14-2v2" />
      <circle cx="9" cy="20.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="23" cy="20.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function ArrowIcon() {
  return (
    <svg viewBox="0 0 20 20" {...shared}>
      <path d="M3.5 10h12m-5-5 5 5-5 5" />
    </svg>
  );
}

export type MarketingIconName = 'pin' | 'bell' | 'route' | 'shield' | 'school' | 'people' | 'check';

export function MarketingIcon({ name }: { name: MarketingIconName }) {
  const icon = (() => {
    switch (name) {
      case 'pin':
        return (
          <>
            <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
            <circle cx="12" cy="10" r="2.5" />
          </>
        );
      case 'bell':
        return (
          <>
            <path d="M18 9a6 6 0 0 0-12 0c0 6-2 7-2 7h16s-2-1-2-7Z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </>
        );
      case 'route':
        return (
          <>
            <circle cx="5" cy="5" r="2" />
            <circle cx="19" cy="19" r="2" />
            <path d="M7 5h5a4 4 0 0 1 0 8h-1a3 3 0 0 0 0 6h6" />
          </>
        );
      case 'shield':
        return (
          <>
            <path d="m12 2 8 3v6c0 5-3 8.5-8 11-5-2.5-8-6-8-11V5l8-3Z" />
            <path d="m9 11.5 2 2 4-4" />
          </>
        );
      case 'school':
        return (
          <>
            <path d="M3 10 12 4l9 6v11H3V10Z" />
            <path d="M9 21v-7h6v7M2 10h20" />
          </>
        );
      case 'people':
        return (
          <>
            <circle cx="9" cy="8" r="3" />
            <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5.5a3 3 0 0 1 0 5.5M18 14a5 5 0 0 1 3 4.5V20" />
          </>
        );
      case 'check':
        return <path d="m4 12 5 5L20 6" />;
    }
  })();

  return (
    <svg viewBox="0 0 24 24" {...shared}>
      {icon}
    </svg>
  );
}
