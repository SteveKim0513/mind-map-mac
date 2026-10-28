import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** One match in the editor document, as ProseMirror positions [from, to). */
export interface TextMatch {
  from: number;
  to: number;
}

/**
 * Lowercase per character so the string keeps its length — a few characters
 * (e.g. "İ") grow when lowercased, which would shift every index after them.
 */
function foldCase(s: string): string {
  let out = '';
  for (const ch of s) {
    const low = ch.toLowerCase();
    out += low.length === ch.length ? low : ch;
  }
  return out;
}

/**
 * Case-insensitive substring matches over the document's visible text, in document
 * order. Matched per textblock, so a hit can span bold/italic/link marks inside one
 * paragraph but never crosses into the next block. Inline leaves (image, hard break)
 * count as one opaque character, which keeps string offsets equal to position offsets.
 */
export function findTextMatches(doc: PMNode, query: string): TextMatch[] {
  const q = foldCase(query.trim());
  if (!q) return [];
  const out: TextMatch[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    node.forEach((child) => {
      text += child.isText ? (child.text ?? '') : '￼'.repeat(child.nodeSize);
    });
    const hay = foldCase(text);
    const base = pos + 1; // first position inside the textblock
    let at = hay.indexOf(q);
    while (at >= 0) {
      out.push({ from: base + at, to: base + at + q.length });
      at = hay.indexOf(q, at + q.length);
    }
    return false; // textblocks hold only inline content
  });
  return out;
}

export interface NoteSearchState {
  query: string;
  matches: TextMatch[];
  /** Index into `matches` of the current one (0 when there are none). */
  active: number;
  decos: DecorationSet;
}

export const noteSearchKey = new PluginKey<NoteSearchState>('noteSearch');

type SearchMeta = { query: string; active?: number };

function build(doc: PMNode, query: string, active: number): NoteSearchState {
  const matches = findTextMatches(doc, query);
  const idx = matches.length ? Math.min(Math.max(active, 0), matches.length - 1) : 0;
  const decos = DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, { class: i === idx ? 'search-hit search-hit-active' : 'search-hit' }),
    ),
  );
  return { query, matches, active: idx, decos };
}

/**
 * Highlights every match of the note find bar's query, the current one stronger.
 * Display only — it never touches the document, so it isn't part of undo and
 * the Markdown file is unaffected. Driven by `setNoteSearch`.
 */
export const SearchHighlight = Extension.create({
  name: 'searchHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin<NoteSearchState>({
        key: noteSearchKey,
        state: {
          init: (_cfg, state) => build(state.doc, '', 0),
          apply(tr: Transaction, prev: NoteSearchState): NoteSearchState {
            const meta = tr.getMeta(noteSearchKey) as SearchMeta | undefined;
            if (meta) return build(tr.doc, meta.query, meta.active ?? 0);
            // Edits (or late-arriving shared content) move or create matches —
            // recompute against the new doc, keeping the current index in range.
            if (tr.docChanged && prev.query) return build(tr.doc, prev.query, prev.active);
            return prev;
          },
        },
        props: {
          decorations: (state) => noteSearchKey.getState(state)?.decos,
        },
      }),
    ];
  },
});

/** Current find state of an editor (empty query when the bar is closed). */
export function getNoteSearch(state: EditorState): NoteSearchState | undefined {
  return noteSearchKey.getState(state);
}

/** Set the query and current match index; an empty query clears all highlights. */
export function noteSearchTr(state: EditorState, query: string, active = 0): Transaction {
  return state.tr.setMeta(noteSearchKey, { query, active } satisfies SearchMeta).setMeta('addToHistory', false);
}
