import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import Image from '@tiptap/extension-image';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { Markdown, type MarkdownStorage } from 'tiptap-markdown';
import { EditorToolbar } from './EditorToolbar';
import { SlashMenu, type SlashItem } from './SlashMenu';
import { fileToDataUrl, imageFilesFrom } from './imageInsert';

interface Props {
  /** Initial Markdown body. The editor owns the document after mount; the parent
   *  remounts (via React key) when a different note loads. */
  body: string;
  onChange: (markdown: string) => void;
}

const PLACEHOLDER = '메모를 시작하세요…  (“/” 를 눌러 블록 추가)';

// Slash-command block menu (power-user path on top of the toolbar).
const SLASH: SlashItem[] = [
  { id: 'h1', label: '제목 1', keys: 'h1 heading title 제목 1', badge: 'H1', run: (c) => c.toggleHeading({ level: 1 }) },
  { id: 'h2', label: '제목 2', keys: 'h2 heading title 제목 2', badge: 'H2', run: (c) => c.toggleHeading({ level: 2 }) },
  { id: 'h3', label: '제목 3', keys: 'h3 heading title 제목 3', badge: 'H3', run: (c) => c.toggleHeading({ level: 3 }) },
  { id: 'bullet', label: '글머리 목록', keys: 'bullet list ul 목록 글머리', icon: 'listBullet', run: (c) => c.toggleBulletList() },
  { id: 'ordered', label: '번호 목록', keys: 'ordered number ol 번호 목록', icon: 'listOrdered', run: (c) => c.toggleOrderedList() },
  { id: 'task', label: '체크리스트', keys: 'task todo check 체크 할일', icon: 'checklist', run: (c) => c.toggleTaskList() },
  { id: 'quote', label: '인용', keys: 'quote blockquote 인용', icon: 'quote', run: (c) => c.toggleBlockquote() },
  { id: 'table', label: '표', keys: 'table grid 표 테이블', icon: 'table', run: (c) => c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }) },
  { id: 'divider', label: '구분선', keys: 'divider hr rule 구분선', icon: 'divider', run: (c) => c.setHorizontalRule() },
];

interface MenuState {
  items: SlashItem[];
  active: number;
  coords: { left: number; top: number };
  query: string; // raw text after "/" (its length = chars to delete with the slash)
}

/** Notion-style rich editor: Markdown is applied live as you type, no edit/preview
 *  toggle. Stored on disk as Markdown via tiptap-markdown. A "/" opens a block menu. */
export function NoteEditor({ body, onChange }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // mirror used by the (creation-time) keydown handler so it sees fresh values
  const m = useRef<{ open: boolean; items: SlashItem[]; active: number; query: string }>({
    open: false,
    items: [],
    active: 0,
    query: '',
  });
  const editorRef = useRef<Editor | null>(null);

  // Insert one or more images as size-capped base64 (paste / drop / toolbar).
  // Returns true when it took over the event so the editor skips default paste.
  const insertImages = (files: File[]): boolean => {
    if (!files.length) return false;
    void (async () => {
      for (const file of files) {
        try {
          const src = await fileToDataUrl(file);
          editorRef.current?.chain().focus().setImage({ src }).run();
        } catch {
          /* skip an unreadable image */
        }
      }
    })();
    return true;
  };

  const close = () => {
    if (!m.current.open) return;
    m.current = { open: false, items: [], active: 0, query: '' };
    setMenu(null);
  };

  // The slash menu is pinned to the caret's viewport position, so any scroll
  // would strand it mid-air. Dismiss it when the page scrolls or resizes —
  // but ignore scrolling within the menu's own list.
  useEffect(() => {
    if (!menu) return;
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('.slash-menu')) return;
      close();
    };
    const onResize = () => close();
    window.addEventListener('scroll', onScroll, true); // capture: catch any scroller
    window.addEventListener('wheel', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('wheel', onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', onResize);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu]);
  const setActive = (n: number) => {
    m.current.active = n;
    setMenu((cur) => (cur ? { ...cur, active: n } : cur));
  };
  const pick = (i: number) => {
    const ed = editorRef.current;
    const item = m.current.items[i];
    if (!ed || !item) return;
    const from = ed.state.selection.from;
    const slashFrom = from - (m.current.query.length + 1);
    // remove the "/query" text, then apply the chosen block command
    ed.chain().focus().deleteRange({ from: slashFrom, to: from }).run();
    (item.run(ed.chain().focus()) as { run: () => boolean }).run();
    close();
  };

  const recompute = (ed: Editor) => {
    const sel = ed.state.selection;
    if (!sel.empty) return close();
    const $from = sel.$from;
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');
    const match = /(?:^|\s)\/([^\s/]*)$/.exec(before);
    if (!match) return close();
    const q = match[1];
    const ql = q.toLowerCase();
    const items = q ? SLASH.filter((it) => it.keys.includes(ql) || it.label.includes(q)) : SLASH;
    if (!items.length) return close();
    const slashFrom = sel.from - (q.length + 1);
    const c = ed.view.coordsAtPos(slashFrom);
    // keep the menu inside the viewport: flip above the caret when there's no
    // room below, and clamp horizontally (≈210px wide, see .slash-menu)
    const W = 210;
    const estH = Math.min(320, items.length * 32 + 12);
    const m8 = 8;
    const left = Math.max(m8, Math.min(c.left, window.innerWidth - W - m8));
    const top =
      c.bottom + 6 + estH <= window.innerHeight - m8
        ? c.bottom + 6
        : Math.max(m8, c.top - 6 - estH);
    m.current = { open: true, items, active: 0, query: q };
    setMenu({ items, active: 0, query: q, coords: { left, top } });
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: PLACEHOLDER }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
    ],
    content: body,
    editorProps: {
      handlePaste: (_view, event) => insertImages(imageFilesFrom(event.clipboardData)),
      handleDrop: (_view, event) => insertImages(imageFilesFrom(event.dataTransfer)),
      // Cmd/Ctrl-click a link to open it externally (plain click keeps editing).
      // openOnClick stays false so a bare click never navigates the Electron shell.
      handleClick: (_view, _pos, event) => {
        if (!event.metaKey && !event.ctrlKey) return false;
        const a = (event.target as HTMLElement)?.closest('a');
        const href = a?.getAttribute('href');
        if (!href) return false;
        window.open(href, '_blank'); // → main setWindowOpenHandler → shell.openExternal
        return true;
      },
      handleKeyDown: (_view, event) => {
        const s = m.current;
        if (!s.open) return false;
        if (event.key === 'ArrowDown') {
          setActive((s.active + 1) % s.items.length);
          return true;
        }
        if (event.key === 'ArrowUp') {
          setActive((s.active - 1 + s.items.length) % s.items.length);
          return true;
        }
        if (event.key === 'Enter' || event.key === 'Tab') {
          pick(s.active);
          return true;
        }
        if (event.key === 'Escape') {
          close();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      onChange((editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown());
      recompute(editor);
    },
    onSelectionUpdate: ({ editor }) => recompute(editor),
    onBlur: () => close(),
  });

  editorRef.current = editor;
  if (!editor) return null;

  return (
    <div className="note-rich">
      <EditorToolbar editor={editor} />
      <div className="note-rich-body" onClick={() => editor.chain().focus().run()}>
        <EditorContent editor={editor} />
      </div>
      {menu && (
        <SlashMenu
          items={menu.items}
          active={menu.active}
          coords={menu.coords}
          onHover={setActive}
          onPick={pick}
        />
      )}
    </div>
  );
}
