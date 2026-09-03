import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../store/workspaceStore';
import { emptyNote, serializeNote } from '../io/noteFormat';
import { Icon } from '../ui/Icon';
import type { BoardNoteRef } from '../types';

interface Props {
  boardFilePath: string | null;
  onPick: (ref: BoardNoteRef) => void;
  onClose: () => void;
}

/** Picker to link a board sticky to a note file — searches the full workspace
 *  note index (mirrors note/NoteLinkPicker.tsx's list, minus the note-side
 *  link write: a board→note link is a one-directional forward reference
 *  stored on the sticky, so nothing needs to be written into the note itself). */
export function BoardNoteLinkPicker({ boardFilePath, onPick, onClose }: Props) {
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const refresh = useWorkspace((s) => s.refresh);
  const root = useWorkspace((s) => s.root);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const notes = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = [...noteIndex].sort((a, b) => a.title.localeCompare(b.title));
    return (s ? list.filter((m) => m.title.toLowerCase().includes(s)) : list).slice(0, 80);
  }, [noteIndex, q]);

  const count = notes.length + 1; // row 0 = "create new"

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    listRef.current?.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const linkExisting = (path: string, title: string) => {
    onClose();
    onPick({ notePath: path, title });
  };

  const createAndLink = async () => {
    onClose();
    const boardDir = boardFilePath?.includes('/') ? boardFilePath.slice(0, boardFilePath.lastIndexOf('/')) : '';
    const dir = boardDir || root;
    const title = (q.trim() || '제목 없음').slice(0, 80);
    try {
      const path = await window.api.createFile(dir, title, serializeNote(emptyNote(title)), '.md');
      onPick({ notePath: path, title });
      await refresh();
    } catch (e) {
      console.error('[board-link] createFile failed', e);
    }
  };

  const runActive = () => {
    if (active === 0) void createAndLink();
    else linkExisting(notes[active - 1].path, notes[active - 1].title);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return onClose();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, count - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runActive();
    }
  };

  return (
    <div className="picker-backdrop" onMouseDown={onClose}>
      <div className="picker" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <Icon name="link" />
          <span>노트 연결</span>
        </div>
        <input
          ref={inputRef}
          className="picker-input"
          placeholder="노트 검색 또는 새 노트 이름…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="picker-list" ref={listRef}>
          <button
            className={`picker-item picker-create${active === 0 ? ' active' : ''}`}
            onMouseMove={() => setActive(0)}
            onClick={() => void createAndLink()}
          >
            <span className="picker-node">
              <Icon name="plus" />
              <span className="picker-node-text">새 노트 만들어 연결{q.trim() ? `: "${q.trim()}"` : ''}</span>
            </span>
          </button>
          {notes.map((m, i) => (
            <button
              key={m.path}
              className={`picker-item${active === i + 1 ? ' active' : ''}`}
              onMouseMove={() => setActive(i + 1)}
              onClick={() => linkExisting(m.path, m.title)}
            >
              <span className="picker-node">
                <Icon name="note" />
                <span className="picker-node-text">{m.title}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="picker-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> 이동</span>
          <span><kbd>↵</kbd> 연결</span>
          <span><kbd>esc</kbd> 닫기</span>
        </div>
      </div>
    </div>
  );
}
