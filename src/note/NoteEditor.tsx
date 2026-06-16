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
import { SESSION_NOTE_PLACEHOLDER } from '../focus/sessionNote';
import { WikiLink } from './wikiLink';
import { Icon } from '../ui/Icon';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';

interface Props {
  /** Initial Markdown body. The editor owns the document after mount; the parent
   *  remounts (via React key) when a different note loads. */
  body: string;
  onChange: (markdown: string) => void;
  /** Session note: treat the scaffold hints as click-to-replace placeholders. */
  scaffold?: boolean;
  /** Create a sibling note titled `title` and return its path (for `[[ ]]` that
   *  targets a not-yet-existing note). Omitted on session notes. */
  onCreateNote?: (title: string) => Promise<string | null>;
  /** Hand the live editor up to the pane (for the 정보 panel's 목차 section). */
  onReady?: (editor: Editor | null) => void;
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
export function NoteEditor({ body, onChange, scaffold, onCreateNote, onReady }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  // mirror used by the (creation-time) keydown handler so it sees fresh values
  const m = useRef<{ open: boolean; items: SlashItem[]; active: number; query: string }>({
    open: false,
    items: [],
    active: 0,
    query: '',
  });
  const editorRef = useRef<Editor | null>(null);

  // ── "[[" note-link autocomplete ──────────────────────────────────────────
  type LinkItem = { title: string; path: string; create?: boolean };
  const [linkMenu, setLinkMenu] = useState<{
    items: LinkItem[];
    active: number;
    coords: { left: number; top: number };
  } | null>(null);
  const lm = useRef<{ open: boolean; items: LinkItem[]; active: number; from: number }>({
    open: false,
    items: [],
    active: 0,
    from: 0,
  });
  const closeLink = () => {
    if (!lm.current.open) return;
    lm.current = { open: false, items: [], active: 0, from: 0 };
    setLinkMenu(null);
  };
  const setLinkActive = (n: number) => {
    lm.current.active = n;
    setLinkMenu((cur) => (cur ? { ...cur, active: n } : cur));
  };
  const pickLink = (i: number) => {
    const ed = editorRef.current;
    const item = lm.current.items[i];
    if (!ed || !item) return;
    const to = ed.state.selection.from;
    // a "create" row makes the note first (resolves the link once indexed)
    if (item.create && onCreateNote) void onCreateNote(item.title);
    // replace the typed "[[query" with the resolved "[[Title]]"
    ed.chain().focus().insertContentAt({ from: lm.current.from, to }, `[[${item.title}]]`).run();
    closeLink();
  };

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
    if (!menu && !linkMenu) return;
    const dismiss = () => {
      close();
      closeLink();
    };
    const onScroll = (e: Event) => {
      if ((e.target as HTMLElement)?.closest?.('.slash-menu')) return;
      dismiss();
    };
    window.addEventListener('scroll', onScroll, true); // capture: catch any scroller
    window.addEventListener('wheel', onScroll, { capture: true, passive: true });
    window.addEventListener('resize', dismiss);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('wheel', onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener('resize', dismiss);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, linkMenu]);
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

  // Position a caret-anchored popup, clamped to the viewport (shared by both menus).
  const popupCoords = (ed: Editor, fromPos: number, estH: number, W = 240) => {
    const c = ed.view.coordsAtPos(fromPos);
    const m8 = 8;
    const left = Math.max(m8, Math.min(c.left, window.innerWidth - W - m8));
    const top =
      c.bottom + 6 + estH <= window.innerHeight - m8 ? c.bottom + 6 : Math.max(m8, c.top - 6 - estH);
    return { left, top };
  };

  const recompute = (ed: Editor) => {
    const sel = ed.state.selection;
    if (!sel.empty) {
      close();
      return closeLink();
    }
    const $from = sel.$from;
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '￼');

    // "[[ note title" → note-link autocomplete (takes precedence over slash)
    const wl = /\[\[([^[\]\n]*)$/.exec(before);
    if (wl) {
      close();
      const raw = wl[1].trim();
      const q = raw.toLowerCase();
      const items: LinkItem[] = useWorkspace
        .getState()
        .noteIndex.filter((mt) => !mt.session && (!q || mt.title.toLowerCase().includes(q)))
        .sort((a, b) => a.title.localeCompare(b.title))
        .slice(0, 8)
        .map((mt) => ({ title: mt.title, path: mt.path }));
      // offer to create a new note when the query names one that doesn't exist yet
      if (raw && onCreateNote && !items.some((it) => it.title.toLowerCase() === q)) {
        items.push({ title: raw, path: '', create: true });
      }
      if (!items.length) return closeLink();
      const from = sel.from - (wl[1].length + 2); // start of "[["
      lm.current = { open: true, items, active: 0, from };
      setLinkMenu({ items, active: 0, coords: popupCoords(ed, from, Math.min(320, items.length * 32 + 12)) });
      return;
    }
    closeLink();

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
      Placeholder.configure({ placeholder: scaffold ? SESSION_NOTE_PLACEHOLDER : PLACEHOLDER }),
      Image.configure({ inline: false, allowBase64: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, linkify: true, transformPastedText: true }),
      WikiLink, // decorates [[note title]] as a clickable chip (plain text on disk)
    ],
    content: body,
    editorProps: {
      // accessible name for the contenteditable surface (axe aria-input-field-name)
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': scaffold ? '작업 기록' : '노트 본문' },
      handlePaste: (_view, event) => insertImages(imageFilesFrom(event.clipboardData)),
      handleDrop: (_view, event) => insertImages(imageFilesFrom(event.dataTransfer)),
      // Cmd/Ctrl-click a link to open it externally (plain click keeps editing).
      // openOnClick stays false so a bare click never navigates the Electron shell.
      handleClick: (_view, _pos, event) => {
        // note wiki-link chip → open a peek of the target note (default = glance,
        // not navigate). "열기" inside the peek opens it in the opposite pane.
        const wl = (event.target as HTMLElement)?.closest('[data-wikilink]') as HTMLElement | null;
        if (wl) {
          const title = wl.getAttribute('data-wikilink') ?? '';
          const meta = useWorkspace.getState().noteByTitle(title);
          const sg = useSession.getState().activeGroup;
          if (!meta) {
            // unresolved link → create the note on click, then peek it
            if (onCreateNote && title.trim()) {
              const r0 = wl.getBoundingClientRect();
              void onCreateNote(title).then((path) => {
                if (path) useUi.getState().openNotePopup([path], { x: r0.left, y: r0.bottom }, undefined, sg);
              });
            } else {
              useUi.getState().toast(`'${title}' 노트를 찾을 수 없습니다`);
            }
            return true;
          }
          if (event.metaKey || event.ctrlKey) {
            // ⌘/Ctrl-click: skip the peek, open straight in the opposite pane
            void window.api
              .readFile(meta.path)
              .then((c) => useSession.getState().openBeside(meta.path, c, sg))
              .catch(() => {});
          } else {
            const r = wl.getBoundingClientRect();
            useUi.getState().openNotePopup([meta.path], { x: r.left, y: r.bottom }, undefined, sg);
          }
          return true; // behave like a link (don't drop the caret into it)
        }
        if (!event.metaKey && !event.ctrlKey) return false;
        const a = (event.target as HTMLElement)?.closest('a');
        const href = a?.getAttribute('href');
        if (!href) return false;
        window.open(href, '_blank'); // → main setWindowOpenHandler → shell.openExternal
        return true;
      },
      handleKeyDown: (_view, event) => {
        // "[[" note-link menu takes the keys first when open
        const l = lm.current;
        if (l.open) {
          if (event.key === 'ArrowDown') return setLinkActive((l.active + 1) % l.items.length), true;
          if (event.key === 'ArrowUp')
            return setLinkActive((l.active - 1 + l.items.length) % l.items.length), true;
          if (event.key === 'Enter' || event.key === 'Tab') return pickLink(l.active), true;
          if (event.key === 'Escape') return closeLink(), true;
          return false;
        }
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
      const md = (editor.storage as unknown as { markdown: MarkdownStorage }).markdown.getMarkdown();
      // tiptap-markdown escapes "[" / "]" → a typed [[note]] serializes as
      // \[\[note\]\] on disk, which breaks the wiki-link regex (index, backlinks,
      // preview). Un-escape just the wiki-link brackets so the file stays clean.
      onChange(md.replace(/\\\[\\\[(.+?)\\\]\\\]/g, '[[$1]]'));
      recompute(editor);
    },
    onSelectionUpdate: ({ editor }) => recompute(editor),
    onBlur: () => {
      close();
      closeLink();
    },
  });

  editorRef.current = editor;

  // re-decorate wiki-links when the note index changes (a target was created or
  // deleted) so the dim "unresolved" state stays accurate without an edit
  const noteIndex = useWorkspace((s) => s.noteIndex);
  useEffect(() => {
    const ed = editorRef.current;
    if (ed) ed.view.dispatch(ed.state.tr.setMeta('wikiRefresh', 1));
  }, [noteIndex]);
  // hand the editor up to the pane (drives the 정보 panel's 목차 section)
  useEffect(() => {
    onReady?.(editor);
    return () => onReady?.(null);
  }, [editor, onReady]);

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
      {linkMenu && (
        <div className="slash-menu linkmenu" style={{ left: linkMenu.coords.left, top: linkMenu.coords.top }}>
          {linkMenu.items.map((it, i) => (
            <button
              key={it.create ? '__create' : it.path}
              className={`slash-item${i === linkMenu.active ? ' active' : ''}`}
              onMouseMove={() => setLinkActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep editor focus
                pickLink(i);
              }}
            >
              <span className="slash-ic">
                <Icon name={it.create ? 'plus' : 'note'} />
              </span>
              <span className="slash-label">
                {it.create ? `새 노트 “${it.title}”` : it.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
