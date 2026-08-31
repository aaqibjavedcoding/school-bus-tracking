import React from 'react';
import type { NavItem } from '../../lib/roles';

export const NavIcon: React.FC<{ name: NavItem['icon'] }> = ({ name }) => {
  const common = {
    className: 'nav-icon',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M16 19a4.8 4.8 0 0 1 5-4.2" />
        </svg>
      );
    case 'bus':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="12" rx="2" />
          <path d="M4 12h16M8 20v-1m8 1v-1M7 16h.01M17 16h.01" />
        </svg>
      );
    case 'route':
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2" />
          <circle cx="18" cy="18" r="2" />
          <path d="M8 7c8 0 0 10 8 10" />
        </svg>
      );
    case 'staff':
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3" />
          <path d="M5 19a7 7 0 0 1 14 0" />
        </svg>
      );
    case 'assign':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <path d="M8 10h8M8 14h5" />
        </svg>
      );
    case 'trip':
      return (
        <svg {...common}>
          <path d="M5 19 19 5M9 5h10v10" />
        </svg>
      );
    case 'map':
      return (
        <svg {...common}>
          <path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2z" />
          <path d="M9 4v14m6-12v14" />
        </svg>
      );
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 13.5 9.5 18 19 7" />
        </svg>
      );
    case 'child':
      return (
        <svg {...common}>
          <circle cx="12" cy="7" r="3" />
          <path d="M6 20v-2a6 6 0 0 1 12 0v2" />
        </svg>
      );
    case 'school':
      return (
        <svg {...common}>
          <path d="M3 10 12 4l9 6v10H3z" />
          <path d="M12 22V12" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9" />
          <path d="M10 20a2 2 0 0 0 4 0" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...common}>
          <path d="M3 12V5a2 2 0 0 1 2-2h7l9 9-9 9z" />
          <circle cx="7.5" cy="7.5" r="1.2" />
        </svg>
      );
    default:
      return null;
  }
};
