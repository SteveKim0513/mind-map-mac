// Pull the user's goal out of a session note's body — the first real line under
// the "🎯" heading. Pure + unit-tested (it guards a subtle serializer trap).
//
// The note template seeds an *italic placeholder* under 🎯. The author writes it
// as `_..._`, but tiptap re-serializes italics as `*..*` on the first autosave —
// so a naive "skip lines starting with _" let the placeholder leak in as a fake
// goal. We strip italic markers and skip the line only when its text is exactly a
// known placeholder hint. That is marker-agnostic AND still extracts a user's
// real goal even if they typed it over the placeholder (so it became italic).

import { PLACEHOLDER_HINTS } from './sessionNote';

/** Strip a leading bullet and any surrounding italic/bold markers. */
function clean(line: string): string {
  return line.replace(/^[-*+]\s+/, '').replace(/^[*_]+|[*_]+$/g, '').trim();
}

export function extractGoal(body: string): string | undefined {
  const lines = body.split('\n');
  const i = lines.findIndex((l) => l.includes('🎯'));
  if (i < 0) return undefined;
  for (let j = i + 1; j < lines.length; j++) {
    const raw = lines[j].trim();
    if (raw.startsWith('##')) break; // next section
    const t = clean(raw);
    if (!t || PLACEHOLDER_HINTS.has(t)) continue; // blank or the untouched placeholder
    return t.slice(0, 200);
  }
  return undefined;
}
