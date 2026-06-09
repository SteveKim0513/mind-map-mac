import type { ReactNode } from 'react';

// Monochrome line icons (SF-Symbols-like). currentColor, 1.6px stroke, sized in em.
const PATHS: Record<string, ReactNode> = {
  note: (
    <>
      <path d="M4 3.5h8.5L16 7v9.5H4z" />
      <path d="M7 9h6M7 12h4" />
    </>
  ),
  link: (
    <>
      <path d="M8.5 11.5 11.5 8.5" />
      <path d="M9 6.5 10.5 5a3 3 0 0 1 4.2 4.2L13 11" />
      <path d="M11 13.5 9.5 15a3 3 0 0 1-4.2-4.2L7 9" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
      <path d="M3.5 8h13M7 3v3M13 3v3" />
    </>
  ),
  alarm: (
    <>
      <circle cx="10" cy="11" r="5.5" />
      <path d="M10 8.5V11l1.8 1.2M4.5 4 6.8 6M15.5 4l-2.3 2" />
    </>
  ),
  check: <path d="M4.5 10.5 8 14l7.5-8" />,
  plus: <path d="M10 4.5v11M4.5 10h11" />,
  chevronRight: <path d="M8 5l5 5-5 5" />,
  chevronDown: <path d="M5 8l5 5 5-5" />,
  trash: (
    <>
      <path d="M4.5 5.5h11M8 5.5V4h4v1.5M6 5.5l.8 10h6.4l.8-10" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5" />
      <path d="m13 13 3 3" />
    </>
  ),
  close: <path d="M5 5l10 10M15 5 5 15" />,
  paint: (
    <>
      <circle cx="10" cy="10" r="6" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" stroke="none" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = '1em' }: { name: IconName; size?: number | string }) {
  return (
    <svg
      className="ic"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}
