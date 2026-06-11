import { useEffect, useMemo, useRef, useState } from 'react';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { useSession } from '../store/sessionStore';
import { addLinkToNoteFile } from './noteLinks';
import { emptyNote, serializeNote } from '../io/noteFormat';
import { Icon } from '../ui/Icon';

/** Refined picker to link a node to an existing note, or create one on the fly. */
export function NoteLinkPicker() {
  const target = useUi((s) => s.linkTarget);
  const close = useUi((s) => s.closeLinkNote);
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

  // index 0 is the "create" row; existing notes follow
  const count = notes.length + 1;

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  // Esc closes regardless of where focus sits (same pattern as ContextMenu/SchedulePopover)
  useEffect(() => {
    if (!target) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [target, close]);
  useEffect(() => {
    listRef.current?.querySelector('.picker-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!target) return null;

  const link = {
    mapId: target.mapId,
    nodeId: target.nodeId,
    nodeText: target.nodeText,
    mapPath: target.mapPath,
  };

  const linkExisting = async (path: string) => {
    close();
    await addLinkToNoteFile(path, link);
  };
  const createAndLink = async () => {
    close();
    // node-created notes are "attached": stored in the hidden .notes/ folder so
    // they never clutter the sidebar; reachable via the node's note satellite.
    const dir = `${root}/.notes`;
    const title = (q.trim() || target.nodeText?.trim() || '제목 없음').slice(0, 80);
    const path = await window.api.createFile(dir, title, serializeNote(emptyNote(title)), '.md');
    await refresh();
    await addLinkToNoteFile(path, link);
    // open it for editing in the right split
    try {
      useSession.getState().openInRight(path, await window.api.readFile(path));
    } catch {
      /* ignore */
    }
  };

  const runActive = () => {
    if (active === 0) void createAndLink();
    else void linkExisting(notes[active - 1].path);
  };
  const onKey = (e: React.KeyboardEvent) => {
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
    <div className="picker-backdrop" onMouseDown={close}>
      <div className="picker note-ctx" onMouseDown={(e) => e.stopPropagation()}>
        <div className="picker-head">
          <Icon name="link" />
          <span>노트 연결</span>
          <span className="picker-head-sub">{target.nodeText || '노드'}</span>
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
              <span className="picker-node-text">
                새 노트 만들어 연결{q.trim() ? `: “${q.trim()}”` : ''}
              </span>
            </span>
          </button>
          {notes.map((m, i) => (
            <button
              key={m.path}
              className={`picker-item${active === i + 1 ? ' active' : ''}`}
              onMouseMove={() => setActive(i + 1)}
              onClick={() => void linkExisting(m.path)}
            >
              <span className="picker-node">
                <Icon name="note" />
                <span className="picker-node-text">{m.title}</span>
              </span>
              {m.links.length > 0 && <span className="picker-tag">연결 {m.links.length}</span>}
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
