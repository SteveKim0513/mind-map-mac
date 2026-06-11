import type { NoteDoc, NoteLink } from '../types';
import { newId } from './formats';

// ── Note files: Markdown body + a small JSON-valued frontmatter block ─────────
//
//   ---
//   id: "note-uuid"
//   title: "리서치 메모"
//   links: [{"mapId":"...","nodeId":"...","nodeText":"..."}]
//   ---
//   (markdown body)
//
// Frontmatter VALUES are JSON-encoded so titles/links with colons, quotes, or
// commas round-trip safely without pulling in a YAML dependency.

export function emptyNote(title = '제목 없음'): NoteDoc {
  return { id: newId(), title, body: '', links: [] };
}

export function serializeNote(note: NoteDoc): string {
  const fm = [
    '---',
    `id: ${JSON.stringify(note.id)}`,
    `title: ${JSON.stringify(note.title)}`,
    `links: ${JSON.stringify(note.links ?? [])}`,
    '---',
    '',
  ].join('\n');
  return fm + note.body;
}

/** Parse a note file. `fallbackTitle` (filename) is used when frontmatter lacks one. */
export function parseNote(text: string, fallbackTitle = '제목 없음'): NoteDoc {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) {
    // plain markdown with no frontmatter → treat the whole thing as body
    return { id: newId(), title: fallbackTitle, body: text, links: [] };
  }
  const fields: Record<string, unknown> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      fields[key] = JSON.parse(raw);
    } catch {
      fields[key] = raw; // tolerate a hand-edited unquoted value
    }
  }
  const body = text.slice(m[0].length);
  return {
    id: typeof fields.id === 'string' ? (fields.id as string) : newId(),
    title: typeof fields.title === 'string' ? (fields.title as string) : fallbackTitle,
    body,
    links: Array.isArray(fields.links) ? (fields.links as NoteLink[]) : [],
  };
}
