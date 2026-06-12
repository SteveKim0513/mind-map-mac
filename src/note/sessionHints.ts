// Makes the session-note scaffold hints behave like placeholders, the safe way.
//
// Native @tiptap/extension-placeholder needs *empty paragraph nodes*, but
// tiptap-markdown drops empty paragraphs on save — so the hints would vanish
// after the first save (REVIEW §6.3 / specs/2026-06-12-session-note-placeholders).
// Instead we keep the hint TEXT in the body (markdown-safe) and:
//   1. decorate any pristine hint paragraph (text === a known hint) as a greyed
//      placeholder, so it reads as guidance, not content;
//   2. select the whole hint on click, so the next input replaces it cleanly.
// Click-select is IME-safe: the selection is set on click, before any Hangul
// composition starts, and typing-over-a-selection composes correctly.
//
// Scoped to session notes (added only when NoteEditor gets `scaffold`), so plain
// notes are untouched.

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const KEY = new PluginKey('sessionHints');

export function SessionHints(hints: ReadonlySet<string>) {
  const isHint = (text: string) => hints.has(text.trim());
  return Extension.create({
    name: 'sessionHints',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: KEY,
          props: {
            decorations(state) {
              const decos: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (node.type.name === 'paragraph' && node.childCount > 0 && isHint(node.textContent)) {
                  decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'session-hint' }));
                }
                return true;
              });
              return DecorationSet.create(state.doc, decos);
            },
            handleClick(view, pos) {
              const $pos = view.state.doc.resolve(pos);
              const node = $pos.parent;
              if (node.type.name !== 'paragraph' || !isHint(node.textContent)) return false;
              const start = $pos.start();
              const end = start + node.content.size;
              const sel = view.state.selection;
              if (sel.from !== start || sel.to !== end) {
                view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start, end)));
              }
              return true; // claimed: don't drop a collapsed cursor inside the hint
            },
          },
        }),
      ];
    },
  });
}
