/** Inline SVG nav icons — avoids brittle Unicode/emoji encoding issues. */

export type NavIconName =
  | 'dashboard'
  | 'projects'
  | 'pdm'
  | 'bar-chart'
  | 's-curve'
  | 'reports'
  | 'submissions'
  | 'approval'
  | 'schedule'
  | 'iar'
  | 'chevron-down'
  | 'arrow-left'
  | 'arrow-right'
  | 'check'
  | 'cross'
  | 'planned'
  | 'actual';

interface NavIconProps {
  name: NavIconName;
  className?: string;
}

const stroke = {
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function NavIcon({ name, className = 'h-4 w-4' }: NavIconProps) {
  const common = { className, viewBox: '0 0 24 24', 'aria-hidden': true as const };

  switch (name) {
    case 'dashboard':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" {...stroke} />
          <rect x="14" y="3" width="7" height="7" rx="1.5" {...stroke} />
          <rect x="3" y="14" width="7" height="7" rx="1.5" {...stroke} />
          <rect x="14" y="14" width="7" height="7" rx="1.5" {...stroke} />
        </svg>
      );
    case 'projects':
      return (
        <svg {...common}>
          <path d="M4 20V9l4-5h8l4 5v11" {...stroke} />
          <path d="M9 20v-6h6v6" {...stroke} />
          <path d="M4 9h16" {...stroke} />
        </svg>
      );
    case 'pdm':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="6" height="5" rx="1" {...stroke} />
          <rect x="15" y="4" width="6" height="5" rx="1" {...stroke} />
          <rect x="9" y="15" width="6" height="5" rx="1" {...stroke} />
          <path d="M6 9v3h12V9M12 12v3" {...stroke} />
        </svg>
      );
    case 'bar-chart':
      return (
        <svg {...common}>
          <path d="M4 6h8M4 11h16M4 16h6M4 21h12" {...stroke} />
        </svg>
      );
    case 's-curve':
      return (
        <svg {...common}>
          <path d="M3 17c3-8 5 4 9-3s4-7 9-9" {...stroke} />
          <path d="M3 20h18" {...stroke} />
        </svg>
      );
    case 'reports':
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7z" {...stroke} />
          <path d="M14 3v4h4M10 12h6M10 16h6" {...stroke} />
        </svg>
      );
    case 'submissions':
    case 'schedule':
      return (
        <svg {...common}>
          <path d="M5 20l9.5-9.5a2.1 2.1 0 013 3L8 23H5z" {...stroke} />
          <path d="M13 8l3 3" {...stroke} />
        </svg>
      );
    case 'approval':
    case 'check':
      return (
        <svg {...common}>
          <path d="M5 12l5 5L20 7" {...stroke} />
        </svg>
      );
    case 'iar':
      return (
        <svg {...common}>
          <path d="M8 4h8a2 2 0 012 2v14l-6-3-6 3V6a2 2 0 012-2z" {...stroke} />
          <path d="M10 9h4M10 13h4" {...stroke} />
        </svg>
      );
    case 'chevron-down':
      return (
        <svg {...common}>
          <path d="M6 9l6 6 6-6" {...stroke} />
        </svg>
      );
    case 'arrow-left':
      return (
        <svg {...common}>
          <path d="M15 6l-6 6 6 6M9 12h12" {...stroke} />
        </svg>
      );
    case 'arrow-right':
      return (
        <svg {...common}>
          <path d="M9 6l6 6-6 6M3 12h12" {...stroke} />
        </svg>
      );
    case 'cross':
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" {...stroke} />
        </svg>
      );
    case 'planned':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" {...stroke} />
        </svg>
      );
    case 'actual':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}
