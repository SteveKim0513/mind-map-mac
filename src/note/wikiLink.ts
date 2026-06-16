import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { WIKILINK_RE } from './wikiLinkText';
import { useWorkspace } from '../store/workspaceStore';

export { WIKILINK_RE, extractWikiTargets } from './wikiLinkText';

/**
 * Renders `[[note title]]` in the note body as a styled, clickable chip — WITHOUT
 * turning it into a custom node. It stays plain text in the Markdown file (so the
 * round-trip is free and the link survives any editor), and we only *decorate* it:
 * faded brackets + a colored, clickable title carrying `data-wikilink`. The click
 * itself is handled in NoteEditor (→ note peek). See spec note-to-note-links.
 */
export const WikiLink = Extension.create({
  name: 'wikiLink',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('wikiLink'),
        props: {
          decorations(state) {
            const decos: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return;
              const text = node.text;
              WIKILINK_RE.lastIndex = 0;
              let m: RegExpExecArray | null;
              while ((m = WIKILINK_RE.exec(text))) {
                const start = pos + m.index;
                const end = start + m[0].length;
                const title = m[1].trim();
                // dim a link whose target note doesn't exist (yet) — clicking it
                // still works (→ create flow in NoteEditor)
                const resolved = !!useWorkspace.getState().noteByTitle(title);
                // faded "[[" / "]]" framing the colored, clickable title
                decos.push(Decoration.inline(start, start + 2, { class: 'wikilink-bracket' }));
                decos.push(
                  Decoration.inline(start + 2, end - 2, {
                    class: resolved ? 'wikilink' : 'wikilink wikilink-unresolved',
                    'data-wikilink': title,
                  }),
                );
                decos.push(Decoration.inline(end - 2, end, { class: 'wikilink-bracket' }));
              }
            });
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});
