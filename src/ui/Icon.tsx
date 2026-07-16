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
  display: (
    <>
      <rect x="3.5" y="4.5" width="13" height="9" rx="1.5" />
      <path d="M7.5 16.5h5M10 13.5v3" />
    </>
  ),
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
  minus: <path d="M4.5 10h11" />,
  edit: (
    <>
      <path d="M12.5 4.5 15.5 7.5 7 16H4v-3z" />
      <path d="M11 6 14 9" />
    </>
  ),
  memo: <path d="M4 5.5h12M4 9h12M4 12.5h7" />,
  chevronUp: <path d="M5 12l5-5 5 5" />,
  chevronLeft: <path d="M12 5l-5 5 5 5" />,
  menu: <path d="M4 6h12M4 10h12M4 14h12" />,
  folder: (
    <path d="M3 5.9c0-.7.6-1.3 1.3-1.3h3.1l1.4 1.6h6c.7 0 1.2.6 1.2 1.3V14c0 .7-.5 1.3-1.2 1.3H4.3C3.6 15.3 3 14.7 3 14z" />
  ),
  folderPlus: (
    <>
      <path d="M3 5.9c0-.7.6-1.3 1.3-1.3h3.1l1.4 1.6h6c.7 0 1.2.6 1.2 1.3V14c0 .7-.5 1.3-1.2 1.3H4.3C3.6 15.3 3 14.7 3 14z" />
      <path d="M10 8.5v4M8 10.5h4" strokeLinecap="round" />
    </>
  ),
  file: (
    <>
      <path d="M5.5 3.5h6L15 7v9.5h-9.5z" />
      <path d="M11.2 3.5V7H15" />
    </>
  ),
  mindmap: (
    <>
      <circle cx="5" cy="10" r="2.3" />
      <circle cx="15" cy="5.6" r="2" />
      <circle cx="15" cy="14.4" r="2" />
      <path d="M7.1 9.1 12.9 6.4M7.1 10.9 12.9 13.6" />
    </>
  ),
  settings: (
    <>
      <path d="M3.5 6.5h7M14 6.5h2.5M3.5 13.5h2.5M9.5 13.5h7" />
      <circle cx="12" cy="6.5" r="1.9" />
      <circle cx="7.5" cy="13.5" r="1.9" />
    </>
  ),
  home: (
    <>
      <path d="M3.8 9.4 10 4l6.2 5.4" />
      <path d="M5.4 8.3V16h9.2V8.3" />
    </>
  ),
  refresh: (
    <>
      <path d="M4.9 11a5.2 5.2 0 1 0 1.1-4.4" />
      <path d="M5 3.6v3.4h3.4" />
    </>
  ),
  expand: <path d="M4 7.6V4h3.6M16 7.6V4h-3.6M4 12.4V16h3.6M16 12.4V16h-3.6" />,
  download: <path d="M10 3.5v8.4M6.4 8.4 10 12l3.6-3.6M5 15.8h10" />,
  sun: (
    <>
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.6v2.1M10 15.3v2.1M2.6 10h2.1M15.3 10h2.1M4.8 4.8l1.5 1.5M13.7 13.7l1.5 1.5M15.2 4.8l-1.5 1.5M6.3 13.7l-1.5 1.5" />
    </>
  ),
  moon: <path d="M15.6 11.4A6 6 0 0 1 8.6 4.4a6 6 0 1 0 7 7z" />,
  star: <path d="m10 3.6 1.9 3.9 4.3.6-3.1 3 .8 4.2L10 13.3 6.2 15.3l.8-4.2-3.1-3 4.3-.6z" />,
  flag: (
    <>
      <path d="M5.6 3.6v13" />
      <path d="M5.6 4.5h8l-1.6 2.6 1.6 2.6h-8z" />
    </>
  ),
  bulb: (
    <>
      <path d="M7 12.2a4 4 0 1 1 6 0c-.6.5-.9 1.1-1 1.8H8c-.1-.7-.4-1.3-1-1.8z" />
      <path d="M8.4 16h3.2" />
    </>
  ),
  pin: (
    <>
      <path d="M10 11.6V16.2" />
      <path d="M6.6 4.4h6.8l-1.3 1.3v3.1l1.7 1.6H6.2l1.7-1.6V5.7z" />
    </>
  ),
  target: (
    <>
      <circle cx="10" cy="10" r="6" />
      <circle cx="10" cy="10" r="2.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="10" cy="10" r="6.4" />
      <path d="M10 6.3V10l2.4 1.7" />
    </>
  ),
  external: (
    <>
      <path d="M7.5 12.5 13 7" />
      <path d="M8.5 6.5H13.5V11.5" />
    </>
  ),
  listBullet: (
    <>
      <circle cx="4.4" cy="7" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="4.4" cy="13" r="1.15" fill="currentColor" stroke="none" />
      <path d="M8 7h8M8 13h8" />
    </>
  ),
  listOrdered: (
    <>
      <path d="M8.2 7h7.8M8.2 13h7.8" />
      <path d="M3.1 5.9 4.2 5.3V8.7" />
      <path d="M3 11.6c0-.6.5-1 1.1-1s1.1.4 1.1 1c0 1.1-2.2 1.6-2.2 2.9h2.3" />
    </>
  ),
  checklist: (
    <>
      <rect x="3.1" y="3.9" width="4.7" height="4.7" rx="1.3" />
      <path d="M4.2 6.2 5.1 7.1 6.7 5.2" />
      <rect x="3.1" y="11.4" width="4.7" height="4.7" rx="1.3" />
      <path d="M10.6 6.25h6M10.6 13.75h6" />
    </>
  ),
  quote: (
    <>
      <path d="M4.7 5.6v8.8" />
      <path d="M8.3 7.7h7.1M8.3 12.3h7.1" />
    </>
  ),
  divider: <path d="M3.4 10h3.1M8.9 10h2.2M13.5 10h3.1" />,
  image: (
    <>
      <rect x="3.2" y="4.2" width="13.6" height="11.6" rx="2" />
      <circle cx="7.3" cy="8.1" r="1.3" />
      <path d="M4 14.2l3.8-3.6 2.7 2.4 2.5-2.2 3 2.8" />
    </>
  ),
  table: (
    <>
      <rect x="3.3" y="4.3" width="13.4" height="11.4" rx="1.6" />
      <path d="M3.3 8.2h13.4M3.3 12h13.4M8 4.3v11.4M12 4.3v11.4" />
    </>
  ),
  template: (
    <>
      <rect x="3" y="4" width="14" height="12" rx="1.6" />
      <path d="M3 7.6h14" />
      <path d="M6 10.8h8M6 13.2h5" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

/** Set of valid icon names — used to tell a line-icon name from a legacy emoji string. */
export const ICON_NAMES = new Set(Object.keys(PATHS));
export const isIconName = (s: string | undefined): s is IconName => !!s && ICON_NAMES.has(s);

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
