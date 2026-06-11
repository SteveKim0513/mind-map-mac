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
