import { useEffect, useRef, useState } from 'react';
import { NoteContext, useNote, useNoteStore, type NoteStore } from '../store/noteStore';
import { serializeNote } from '../io/noteFormat';
import { fileNameFromTitle } from '../io/autoName';
import { NoteEditor } from './NoteEditor';
import { NodePicker } from './NodePicker';
import { addLinkToNoteFile, reindexFromNote, revealNode } from './noteLinks';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import { Icon } from '../ui/Icon';
import { fmtDuration } from '../focus/aggregate';
import { endFocusSession } from '../focus/controller';
import type { FocusSession } from '../types';
import type { Tab } from '../store/sessionStore';

interface Props {
  tab: Tab;
  isActive: boolean;
  onActivate: () => void;
}

export function NotePane({ tab, isActive, onActivate }: Props) {
  return (
    <NoteContext.Provider value={tab.store as NoteStore}>
      <div className={`pane note-pane${isActive ? ' active' : ''}`} onPointerDownCapture={onActivate}>
        <NotePaneBody />
      </div>
    </NoteContext.Provider>
  );
}

function NotePaneBody() {
  const store = useNoteStore();
  const note = useNote((s) => s.note);
  const dirty = useNote((s) => s.dirty);
  const filePath = useNote((s) => s.filePath);
  const setTitle = useNote((s) => s.setTitle);
  const setBody = useNote((s) => s.setBody);
  const markSaved = useNote((s) => s.markSaved);
  const removeLink = useNote((s) => s.removeLink);

  const [pickerOpen, setPickerOpen] = useState(false);

  // attached notes live in the hidden .notes/ folder; offer to promote into the tree
  const isAttached = !!filePath && filePath.includes('/.notes/');
  const promote = async () => {
    if (!filePath) return;
    const sess = useSession.getState();
    await sess.flushSaves(filePath);
    const root = filePath.slice(0, filePath.indexOf('/.notes/'));
    const newPath = await window.api.move(filePath, root);
    if (!newPath) return;
    sess.renamePath(filePath, newPath);
    await useWorkspace.getState().refresh();
  };

  const unlink = (mapId: string, nodeId: string) => {
    removeLink(mapId, nodeId);
    void useSession
      .getState()
      .flushSaves(filePath ?? '')
      .then(() => reindexFromNote(filePath ?? '', store.getState().note));
  };

  // debounced autosave to the note's .md file
  useEffect(() => {
    if (!dirty || !filePath) return;
    const t = setTimeout(() => {
      void window.api.save(filePath, serializeNote(store.getState().note)).then((p) => {
        if (p) {
          markSaved(p);
          // keep the workspace link index (titles/links) fresh so pickers,
          // node chips and popups reflect edits immediately
          reindexFromNote(filePath, store.getState().note);
        }
      });
    }, 800);
    return () => clearTimeout(t);
  }, [dirty, note, filePath, markSaved, store]);

  // The title drives the file name (spec: note-title-filename-sync). Debounced
  // rename, one-directional: editing the title renames the .md so the sidebar
  // and tab follow. Attached notes stay in .notes/ (rename keeps the dirname).
  const renaming = useRef(false);
  const isSession = !!note.session;
  useEffect(() => {
    // Session notes are named once at creation (start time) and never renamed —
    // their title contains ":" which the filename sanitizer would churn forever (§14-H).
    if (isSession || !filePath || renaming.current) return;
    const base = (filePath.split('/').pop() ?? '').replace(/\.md$/, '');
    const wanted = fileNameFromTitle(note.title);
    if (!wanted || wanted === base) return;
    const t = setTimeout(() => {
      renaming.current = true;
      void (async () => {
        const sess = useSession.getState();
        try {
          await sess.flushSaves(filePath); // write frontmatter before moving the file
          const newPath = await window.api.rename(filePath, `${wanted}.md`);
          sess.renamePath(filePath, newPath);
          await useWorkspace.getState().refresh();
        } catch {
          /* keep the current name; a later edit retries */
        } finally {
          renaming.current = false;
        }
      })();
    }, 600);
    return () => clearTimeout(t);
  }, [note.title, filePath, isSession]);

  return (
    <div className="note-doc">
      {note.session && <SessionMetaBanner session={note.session} />}
      <div className="note-head">
        <input
          className="note-title"
          value={note.title}
          placeholder="제목 없음"
          readOnly={isSession}
          onChange={(e) => setTitle(e.target.value)}
        />
        <span className={`note-save${dirty ? ' saving' : ''}`} title={dirty ? '저장 중' : '저장됨'}>
          {dirty ? '저장 중…' : '저장됨'}
        </span>
        {isAttached && (
          <button className="note-promote" title="이 노트를 사이드바 목록에 표시" onClick={() => void promote()}>
            <Icon name="folder" />
            사이드바에 보이기
          </button>
        )}
        {/* session notes have an immutable node attribution — no link editing */}
        {!isSession && (
          <button className="note-link-btn" title="노드에 연동" onClick={() => setPickerOpen(true)}>
            <Icon name="link" />
            연동
          </button>
        )}
      </div>

      {!isSession && note.links.length > 0 && (
        <div className="note-links">
          {note.links.map((l) => (
            <span key={`${l.mapId}:${l.nodeId}`} className="note-link-chip">
              <button className="nlc-go" title="노드로 이동" onClick={() => void revealNode(l)}>
                <Icon name="mindmap" />
                <span className="nlc-text">{l.nodeText || '노드'}</span>
              </button>
              <button className="nlc-x" title="연동 해제" onClick={() => unlink(l.mapId, l.nodeId)}>
                <Icon name="close" />
              </button>
            </span>
          ))}
        </div>
      )}

      {pickerOpen && (
        <NodePicker
          onClose={() => setPickerOpen(false)}
          onPick={(link) => {
            setPickerOpen(false);
            if (filePath) void addLinkToNoteFile(filePath, link);
          }}
        />
      )}

      {/* key by note id so switching to another note loads its content fresh */}
      <NoteEditor key={note.id} body={note.body} onChange={setBody} />
    </div>
  );
}

const clock = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Read-only meta header for a focus-session note — driven by frontmatter, not
 *  the editable body, so the user can never alter start/end/target (§6.2). */
function SessionMetaBanner({ session }: { session: FocusSession }) {
  const active = useUi((s) => s.activeFocus);
  const running = session.end == null;
  const isThis = active?.notePath && active.sessionId === session.sessionId;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running ? Math.max(0, Math.round((now - session.start) / 1000)) : session.durationSec;
  const right = running ? (
    isThis ? (
      <button className="sess-end" onClick={() => void endFocusSession()}>
        종료
      </button>
    ) : (
      <span className="sess-running">진행 중</span>
    )
  ) : null;

  return (
    <div className={`session-banner${running ? ' running' : ''}`}>
      <div className="session-banner-main">
        <Icon name="clock" />
        <span className="session-banner-title">집중 세션</span>
        <span className="session-banner-time">
          {running ? fmtClock(elapsed) : fmtDuration(session.durationSec)}
        </span>
        {right}
      </div>
      <div className="session-banner-sub">
        {clock(session.start)}
        {session.end != null && ` – ${clock(session.end)}`} · 대상{' '}
        <button className="session-target" title="노드로 이동" onClick={() => void revealNode(session.link)}>
          「{session.link.nodeText || '노드'}」
        </button>
        {session.estimated && <span className="session-est"> · 추정</span>}
      </div>
    </div>
  );
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
}
