import { useEffect, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { getNoteSearch, noteSearchTr } from './searchHighlight';
import { Icon } from '../ui/Icon';

/**
 * Find-in-note bar: highlights every match of the query in the note body, the
 * current one stronger, and steps through them (Enter/↓ next, ⇧Enter/↑ previous).
 * Esc closes it, leaving the current match selected so typing continues there.
 * Same look and keys as the map's node find bar (`search/Search.tsx`).
 */
export function NoteFindBar({
  editor,
  initialQuery,
  focusNonce,
  onClose,
}: {
  editor: Editor;
  initialQuery: string;
  /** Bumped when ⌘F is pressed again while open — refocus the input. */
  focusNonce: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  // Scroll to the current match once it exists. Shared notes fill in late and
  // a fresh query may find nothing until then, so this waits for count > 0.
  const wantScroll = useRef(true);

  const { count, active } = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const s = ed ? getNoteSearch(ed.state) : undefined;
      return { count: s?.matches.length ?? 0, active: s?.active ?? 0 };
    },
  }) ?? { count: 0, active: 0 };

  const revealActive = () => {
    // after the decoration for the new current match has been painted
    requestAnimationFrame(() => {
      if (editor.isDestroyed) return;
      editor.view.dom.querySelector('.search-hit-active')?.scrollIntoView({ block: 'center' });
    });
  };

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  useEffect(() => {
    if (editor.isDestroyed) return;
    editor.view.dispatch(noteSearchTr(editor.state, query.trim(), 0));
    wantScroll.current = true;
  }, [editor, query]);

  useEffect(() => {
    if (wantScroll.current && count > 0) {
      wantScroll.current = false;
      revealActive();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, query]);

  // closing (or unmounting with the pane) removes every highlight
  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.view.dispatch(noteSearchTr(editor.state, ''));
    },
    [editor],
  );

  const go = (delta: number) => {
    if (count === 0) return;
    const next = (active + delta + count) % count;
    editor.view.dispatch(noteSearchTr(editor.state, query.trim(), next));
    revealActive();
  };

  const close = () => {
    const s = getNoteSearch(editor.state);
    const m = s?.matches[s.active];
    if (m) editor.chain().setTextSelection({ from: m.from, to: m.to }).focus(undefined, { scrollIntoView: false }).run();
    onClose();
  };

  const hasQuery = query.trim() !== '';
  return (
    // Stop clicks reaching the note body, whose click handler focuses the editor.
    <div className="note-find-anchor" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
      <div className="search note-find" role="search" data-testid="note-find">
        <input
          ref={inputRef}
          placeholder="노트에서 찾기…"
          aria-label="노트에서 찾기"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              go(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              close();
            }
          }}
        />
        <span className="count" data-testid="note-find-count">
          {count ? `${active + 1}/${count}` : hasQuery ? '없음' : '0'}
        </span>
        <button className="search-nav" title="이전 (⇧Enter)" aria-label="이전" onClick={() => go(-1)}>
          <Icon name="chevronUp" />
        </button>
        <button className="search-nav" title="다음 (Enter)" aria-label="다음" onClick={() => go(1)}>
          <Icon name="chevronDown" />
        </button>
        <button className="search-nav" title="닫기 (Esc)" aria-label="닫기" onClick={close}>
          <Icon name="close" />
        </button>
      </div>
    </div>
  );
}
