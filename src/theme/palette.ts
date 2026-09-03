/**
 * Single source of truth for the decorative node-tag palette (Layer 3).
 *
 * Colours live in CSS as `--tag-<key>` tokens (light + dark variants in
 * styles.css). Documents store the *semantic key* (e.g. "violet"), never a raw
 * hex — so the palette can be retuned anytime without rewriting saved files.
 *
 * Semantic / state colours (selection, done, scheduled, search…) are a separate
 * layer (`--state-*` / `--primary`) and are intentionally NOT user-pickable.
 */

export const TAG_KEYS = [
  'red',
  'orange',
  'yellow',
  'green',
  'teal',
  'violet',
  'pink',
  'brown',
] as const;

export type TagKey = (typeof TAG_KEYS)[number];

/** Default (Korean) display name for each tag key, shown until a document defines
 *  its own label via `MindMapDoc.tagLabels` (색상 태그 범례, 2026-09-03). Also
 *  reusable anywhere a tag key needs a human-readable fallback (e.g. tooltips). */
export const TAG_DEFAULT_LABELS: Record<TagKey, string> = {
  red: '로즈',
  orange: '주황',
  yellow: '노랑',
  green: '초록',
  teal: '틸',
  violet: '보라',
  pink: '핑크',
  brown: '브라운',
};

const TAG_SET = new Set<string>(TAG_KEYS);

/**
 * Resolve a stored colour to a CSS value usable in `background`, `fill`,
 * `color-mix`, etc. Tag keys become `var(--tag-<key>)` (auto-themed); any legacy
 * raw hex left in old documents passes through untouched so it still renders.
 */
export function tagVar(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (color[0] === '#' || color.startsWith('rgb')) return color; // legacy / custom
  return `var(--tag-${color})`;
}

/**
 * Legacy raw-hex tags (pre-semantic palette) → new tag key. Applied once on
 * document load. Note: the old "sky" (#62aef0) had no blue equivalent in the new
 * palette — blue is now reserved for selection — so it folds into `teal`.
 */
const LEGACY_HEX: Record<string, TagKey> = {
  '#62aef0': 'teal', // old sky → teal (blue is now selection-only)
  '#d6b6f6': 'violet',
  '#ff64c8': 'pink',
  '#dd5b00': 'orange',
  '#2a9d99': 'teal',
  '#1aae39': 'green',
};

/** Migrate a single stored colour to a semantic key (idempotent). */
export function normalizeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  if (TAG_SET.has(color)) return color; // already a key
  const lower = color.toLowerCase();
  if (LEGACY_HEX[lower]) return LEGACY_HEX[lower];
  return color; // unknown custom value — leave as-is, tagVar() passes it through
}

/** Duplicated from styles.css `--tag-*` (not read from the DOM, so contrast
 *  can be computed synchronously with no layout round-trip) — keep in sync
 *  if the palette is retuned. Used by `contrastInk` for board sticky text. */
const TAG_HEX: Record<TagKey, { light: string; dark: string }> = {
  red: { light: '#c95d6f', dark: '#e07d92' },
  orange: { light: '#d9854a', dark: '#e6a064' },
  yellow: { light: '#bfa12f', dark: '#d4bb52' },
  green: { light: '#57a679', dark: '#6fc699' },
  teal: { light: '#459b92', dark: '#57bdb0' },
  violet: { light: '#9a78cf', dark: '#b596df' },
  pink: { light: '#c869b0', dark: '#db84c8' },
  brown: { light: '#936c45', dark: '#b88f63' },
};

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Best-contrast ink for text on a tag-coloured background (WCAG relative
 *  luminance) — e.g. board sticky notes, whose background is user-picked and
 *  can't assume a fixed ink colour the way the neutral canvas does. Unknown/
 *  legacy raw-hex colours fall back to dark ink (every current tag pastel
 *  reads fine with dark text; this only matters if the palette is retuned
 *  toward darker hues). Pair with the `--ink-on-tag-dark`/`-light` CSS vars. */
export function contrastInk(color: string | undefined, theme: 'light' | 'dark'): 'dark' | 'light' {
  if (!color || !TAG_SET.has(color)) return 'dark';
  const hex = TAG_HEX[color as TagKey][theme];
  const l = relativeLuminance(hex);
  // WCAG contrast ratio against pure black (L=0) vs pure white (L=1) — pick
  // whichever ink actually reads better, not just "is the bg lighter than
  // 50% gray" (that threshold misclassifies most of these pastels, e.g.
  // yellow, which is well under 0.5 in linear luminance but still wants
  // dark text — the bug reported 2026-09-03: every color rendered white).
  const contrastBlack = (l + 0.05) / 0.05;
  const contrastWhite = 1.05 / (l + 0.05);
  return contrastBlack >= contrastWhite ? 'dark' : 'light';
}
