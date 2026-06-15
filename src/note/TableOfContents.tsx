import { useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { Icon } from '../ui/Icon';

interface Head {
  level: number;
  text: string;
  pos: number;
}

/** Collapsible table of contents built from the note's headings. Closed by
 *  default; clicking a heading scrolls the editor to it. Hidden when there are
 *  fewer than 2 headings (not worth a TOC). */
export function TableOfContents({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);

  const headings = useEditorState({
    editor,
    selector: ({ editor }) => {
      const items: Head[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading') {
          items.push({ level: (node.attrs.level as number) ?? 1, text: node.textContent, pos });
        }
        return true;
      });
      return items;
    },
    equalityFn: (a, b) =>
      !!a && !!b && a.length === b.length && a.every((x, i) => x.pos === b[i].pos && x.text === b[i].text && x.level === b[i].level),
  })!;

  if (headings.length < 2) return null;

  const go = (pos: number) => {
    setOpen(false);
    editor.chain().focus().setTextSelection(pos + 1).run();
    const at = editor.view.domAtPos(pos + 1).node;
    const el = (at instanceof HTMLElement ? at : at.parentElement)?.closest('h1, h2, h3') as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className={`note-toc${open ? ' open' : ''}`}>
      <button className="note-toc-btn" onClick={() => setOpen((o) => !o)} title="목차">
        <Icon name={open ? 'chevronDown' : 'chevronRight'} />
        <span>목차</span>
        <span className="note-toc-count">{headings.length}</span>
      </button>
      {open && (
        <div className="note-toc-list">
          {headings.map((h, i) => (
            <button key={`${h.pos}-${i}`} className={`note-toc-item lvl${h.level}`} onClick={() => go(h.pos)}>
              {h.text.trim() || '제목 없음'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
