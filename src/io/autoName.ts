/**
 * Auto-naming for untitled files: a map created without a name ("제목 없음")
 * takes its file name from the first center topic the user types.
 * Spec: docs/product/specs/2026-06-11-untitled-autoname.md
 */

/** Matches the names our create paths generate: "제목 없음", "제목 없음 2", … */
export function isUntitledName(name: string): boolean {
  return /^제목 없음( \d+)?$/.test(name);
}

/** Derive a safe file name from a node title; null if nothing usable remains. */
export function fileNameFromTitle(text: string): string | null {
  const cleaned = text
    .replace(/[\x00-\x1f\x7f]/g, '') // control chars (e.g. a literal backspace from a paste)
    .replace(/[/\\:*?"<>|]/g, ' ') // path separators + chars invalid on common filesystems
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
    .trim();
  if (!cleaned || cleaned.startsWith('.')) return null; // never create hidden files
  return cleaned;
}
