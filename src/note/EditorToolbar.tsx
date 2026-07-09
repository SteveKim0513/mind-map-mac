import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEditorState, type Editor } from '@tiptap/react';
import { Icon } from '../ui/Icon';
import { fileToDataUrl } from './imageInsert';
import type { MetaTemplate } from '../types';

export interface EditorToolbarProps {
  editor: Editor;
  /** When provided, toolbar image picks go through this (handles disk write + imagePathMap). */
  onInsertImages?: (files: File[]) => void;
  templates?: MetaTemplate[];
  onAddMeta?: (templateId: string) => void;
}

// Toolbar bound to the live TipTap editor. Buttons run editor commands and light
// up when the cursor sits inside the matching formatting.

export function EditorToolbar({ editor, onInsertImages, templates, onAddMeta }: EditorToolbarProps) {
  const [linking, setLinking] = useState(false);
  const [url, setUrl] = useState('');

  const active = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor.isActive('bold'),
      italic: editor.isActive('italic'),
      code: editor.isActive('code'),
      codeBlock: editor.isActive('codeBlock'),
      h1: editor.isActive('heading', { level: 1 }),
      h2: editor.isActive('heading', { level: 2 }),
      h3: editor.isActive('heading', { level: 3 }),
      bullet: editor.isActive('bulletList'),
      ordered: editor.isActive('orderedList'),
      task: editor.isActive('taskList'),
      quote: editor.isActive('blockquote'),
      link: editor.isActive('link'),
      table: editor.isActive('table'),
    }),
  })!;

  const chain = () => editor.chain().focus();

  const fileRef = useRef<HTMLInputElement>(null);
  const onPickImages = async (files: FileList | null) => {
    const list = Array.from(files ?? []);
    if (onInsertImages) {
      onInsertImages(list);
    } else {
      for (const file of list) {
        try {
          const src = await fileToDataUrl(file);
          editor.chain().focus().setImage({ src }).run();
        } catch {
          /* skip */
        }
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const onLinkClick = () => {
    if (active.link) {
      chain().unsetLink().run();
      return;
    }
    setUrl((editor.getAttributes('link').href as string) || 'https://');
    setLinking(true);
  };
  const applyLink = () => {
    const href = url.trim();
    if (href && href !== 'https://') {
      if (editor.state.selection.empty) {
        // no text selected → insert the URL itself as the linked text
        chain()
          .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
          .run();
      } else {
        chain().extendMarkRange('link').setLink({ href }).run();
      }
    } else {
      editor.commands.focus();
    }
    setLinking(false);
    setUrl('');
  };

  if (linking) {
    return (
      <div className="md-toolbar md-toolbar--link">
        <Icon name="link" />
        <input
          autoFocus
          className="md-link-input"
          placeholder="https://…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyLink();
            if (e.key === 'Escape') {
              setLinking(false);
              setUrl('');
              editor.commands.focus();
            }
          }}
        />
        <button className="md-tb-btn" title="적용" onMouseDown={(e) => e.preventDefault()} onClick={applyLink}>
          <Icon name="check" />
        </button>
        <button
          className="md-tb-btn"
          title="취소"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setLinking(false);
            setUrl('');
            editor.commands.focus();
          }}
        >
          <Icon name="close" />
        </button>
      </div>
    );
  }

  const Btn = ({
    on,
    title,
    onClick,
    children,
    cls,
  }: {
    on?: boolean;
    title: string;
    onClick: () => void;
    children: ReactNode;
    cls?: string;
  }) => (
    <button
      type="button"
      className={`md-tb-btn${cls ? ' ' + cls : ''}${on ? ' on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );

  const H = (n: number) => (
    <span className="md-h">
      H<span className="md-h-n">{n}</span>
    </span>
  );

  return (
    <div className="md-toolbar">
      <div className="md-tb-group">
        <Btn on={active.h1} title="큰 제목" cls="md-tb-type" onClick={() => {
          if (active.h1) { chain().toggleHeading({ level: 1 }).run(); }
          else { chain().clearNodes().toggleHeading({ level: 1 }).run(); }
        }}>{H(1)}</Btn>
        <Btn on={active.h2} title="중간 제목" cls="md-tb-type" onClick={() => {
          if (active.h2) { chain().toggleHeading({ level: 2 }).run(); }
          else { chain().clearNodes().toggleHeading({ level: 2 }).run(); }
        }}>{H(2)}</Btn>
        <Btn on={active.h3} title="작은 제목" cls="md-tb-type" onClick={() => {
          if (active.h3) { chain().toggleHeading({ level: 3 }).run(); }
          else { chain().clearNodes().toggleHeading({ level: 3 }).run(); }
        }}>{H(3)}</Btn>
      </div>
      <span className="md-tb-sep" aria-hidden="true" />
      <div className="md-tb-group">
        <Btn on={active.bold} title="굵게  (⌘B)" cls="md-tb-type mdb-bold" onClick={() => chain().toggleBold().run()}>B</Btn>
        <Btn on={active.italic} title="기울임  (⌘I)" cls="md-tb-type mdb-italic" onClick={() => chain().toggleItalic().run()}>I</Btn>
        <Btn on={active.code} title="인라인 코드" cls="md-tb-type mdb-code" onClick={() => chain().toggleCode().run()}>&lt;/&gt;</Btn>
      </div>
      <span className="md-tb-sep" aria-hidden="true" />
      <div className="md-tb-group">
        <Btn on={active.bullet} title="글머리 목록" onClick={() => {
          if (active.bullet) { chain().toggleBulletList().run(); }
          else { chain().clearNodes().toggleBulletList().run(); }
        }}><Icon name="listBullet" /></Btn>
        <Btn on={active.ordered} title="번호 목록" onClick={() => {
          if (active.ordered) { chain().toggleOrderedList().run(); }
          else { chain().clearNodes().toggleOrderedList().run(); }
        }}><Icon name="listOrdered" /></Btn>
        <Btn on={active.task} title="체크리스트" onClick={() => {
          if (active.task) { chain().toggleTaskList().run(); }
          else { chain().clearNodes().toggleTaskList().run(); }
        }}><Icon name="checklist" /></Btn>
        <Btn on={active.quote} title="인용" onClick={() => {
          if (active.quote) { chain().toggleBlockquote().run(); }
          else { chain().clearNodes().toggleBlockquote().run(); }
        }}><Icon name="quote" /></Btn>
        <Btn on={active.codeBlock} title="코드블록" cls="md-tb-type mdb-code" onClick={() => {
          if (active.codeBlock) { chain().toggleCodeBlock().run(); }
          else { chain().clearNodes().toggleCodeBlock().run(); }
        }}>{'{ }'}</Btn>
      </div>
      <span className="md-tb-sep" aria-hidden="true" />
      <div className="md-tb-group">
        <Btn on={active.link} title="링크" onClick={onLinkClick}><Icon name="link" /></Btn>
        <Btn title="이미지" onClick={() => fileRef.current?.click()}><Icon name="image" /></Btn>
        <Btn title="표" onClick={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Icon name="table" /></Btn>
        <Btn title="구분선" onClick={() => chain().setHorizontalRule().run()}><Icon name="divider" /></Btn>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => void onPickImages(e.target.files)}
        />
      </div>
      {/* table editing — only while the cursor is inside a table (markdown-safe;
          no column resize — GFM has no width, see decisions/0003) */}
      {active.table && (
        <>
          <span className="md-tb-sep" aria-hidden="true" />
          <div className="md-tb-group">
            <Btn title="행 추가 (아래)" cls="md-tb-type" onClick={() => chain().addRowAfter().run()}>행+</Btn>
            <Btn title="행 삭제" cls="md-tb-type" onClick={() => chain().deleteRow().run()}>행−</Btn>
            <Btn title="열 추가 (오른쪽)" cls="md-tb-type" onClick={() => chain().addColumnAfter().run()}>열+</Btn>
            <Btn title="열 삭제" cls="md-tb-type" onClick={() => chain().deleteColumn().run()}>열−</Btn>
            <Btn title="표 삭제" onClick={() => chain().deleteTable().run()}><Icon name="trash" /></Btn>
          </div>
        </>
      )}
      {templates && templates.length > 0 && onAddMeta && (
        <>
          <span className="md-tb-sep" aria-hidden="true" />
          <MetaAddButton templates={templates} onAdd={onAddMeta} />
        </>
      )}
    </div>
  );
}

function MetaAddButton({ templates, onAdd }: { templates: MetaTemplate[]; onAdd: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (
        !btnRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const handleClick = () => {
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen((o) => !o);
  };

  return (
    <div className="meta-add-wrap">
      <button
        ref={btnRef}
        className="md-tb-btn md-tb-type"
        title="메타 추가"
        onMouseDown={(e) => e.preventDefault()}
        onClick={handleClick}
      >
        메타+
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="meta-add-menu"
          style={{ position: 'fixed', top: menuPos.top, left: menuPos.left }}
        >
          {templates.map((t) => (
            <button
              key={t.id}
              className="meta-add-item"
              onClick={() => { onAdd(t.id); setOpen(false); }}
            >
              {t.name}
            </button>
          ))}
        </div>,
        document.body
      )}
    </div>
  );
}
