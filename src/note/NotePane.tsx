import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { NoteContext, useNote, useNoteStore, type NoteStore } from '../store/noteStore';
import { emptyNote, serializeNote } from '../io/noteFormat';
import { fileNameFromTitle } from '../io/autoName';
import { NoteEditor } from './NoteEditor';
import { ImageLightbox } from './ImageLightbox';
import { NodePicker } from './NodePicker';
import { NoteMetaBlocks } from './NoteMetaBlock';
import { addLinkToNoteFile, reindexFromNote, renameWikiLinks, revealNode } from './noteLinks';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import { useMetaStore } from '../store/metaStore';
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
  const setMetaBlocks = useNote((s) => s.setMetaBlocks);

  const templates = useMetaStore((s) => s.templates);
  const metaLoaded = useMetaStore((s) => s.loaded);

  useEffect(() => {
    if (!metaLoaded) void useMetaStore.getState().load();
  }, [metaLoaded]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // live editor (handed up from NoteEditor) + its headings, for the 목차 section
  const [editor, setEditor] = useState<Editor | null>(null);
  const [headings, setHeadings] = useState<Head[]>([]);
  const tocCount = headings.length >= 2 ? headings.length : 0; // a TOC needs ≥2 headings
  const goHeading = (pos: number) => {
    if (!editor) return;
    editor.chain().focus().setTextSelection(pos + 1).run();
    const at = editor.view.domAtPos(pos + 1).node;
    const el = (at instanceof HTMLElement ? at : at.parentElement)?.closest('h1, h2, h3') as HTMLElement | null;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setInfoOpen(false);
  };

  // backlinks: notes that wiki-link ([[ ]]) to THIS note — the other half of
  // bidirectional linking (navigate back even if only the other side linked).
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const backlinks = useMemo(
    () => (filePath && !note.session ? useWorkspace.getState().backlinks(note.title, filePath) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [noteIndex, note.title, filePath, note.session],
  );
  // open a peek of a related note, anchored to the clicked chip (same model as a
  // body wiki-link: glance first, "열기" promotes to the opposite pane)
  const peekNote = (path: string, e: React.MouseEvent) => {
    const sg = useSession.getState().activeGroup;
    if (e.metaKey || e.ctrlKey) {
      // ⌘/Ctrl-click: skip the peek, open straight in the opposite pane
      void window.api.readFile(path).then((c) => useSession.getState().openBeside(path, c, sg)).catch(() => {});
      return;
    }
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useUi.getState().openNotePopup([path], { x: r.left, y: r.bottom }, undefined, sg);
  };
  // node links live in the panel for ordinary notes; session notes show theirs in
  // the SessionMetaBanner instead, so don't double-count them here
  const nodeLinkCount = note.session ? 0 : note.links.length;
  const metaCount = tocCount + nodeLinkCount + backlinks.length;

  // create a note for a `[[ ]]` that targets one that doesn't exist yet — in the
  // SAME folder as this note (ADR 0009 sibling rule), then refresh so it resolves
  const createSiblingNote = async (title: string): Promise<string | null> => {
    if (!filePath) return null;
    const dir = filePath.slice(0, filePath.lastIndexOf('/'));
    const t = title.trim() || '제목 없음';
    try {
      const path = await window.api.createFile(dir, t, serializeNote(emptyNote(t)), '.md');
      await useWorkspace.getState().refresh();
      return path;
    } catch {
      useUi.getState().toast('노트를 만들 수 없습니다');
      return null;
    }
  };

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
      // Never recreate a note that's being trashed — see useSession.deletingPaths.
      if (useSession.getState().isDeleting(filePath)) return;
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
  // the title as of the last settled rename / load — the `[[old title]]` to rewrite
  const prevTitle = useRef(note.title);
  useEffect(() => {
    prevTitle.current = store.getState().note.title;
  }, [filePath, store]);
  useEffect(() => {
    // Session notes are named once at creation (start time) and never renamed —
    // their title contains ":" which the filename sanitizer would churn forever (§14-H).
    if (isSession || !filePath || renaming.current) return;
    const base = (filePath.split('/').pop() ?? '').replace(/\.md$/, '');
    const wanted = fileNameFromTitle(note.title);
    // Skip if identical, OR if the current filename is just a longer version of
    // the wanted name (e.g. a file imported with a >60-char name whose first 60
    // chars already match — renaming would create a collision with the truncated copy).
    if (!wanted || wanted === base || base.startsWith(wanted)) return;
    const t = setTimeout(() => {
      renaming.current = true;
      const oldTitle = prevTitle.current;
      const newTitle = note.title;
      void (async () => {
        const sess = useSession.getState();
        try {
          await sess.flushSaves(filePath); // write frontmatter before moving the file
          const newPath = await window.api.rename(filePath, `${wanted}.md`);
          sess.renamePath(filePath, newPath);
          await useWorkspace.getState().refresh();
          // keep note↔note links pointing here: [[oldTitle]] → [[newTitle]] everywhere
          await renameWikiLinks(oldTitle, newTitle);
          prevTitle.current = newTitle;
        } catch {
          /* keep the current name; a later edit retries */
        } finally {
          renaming.current = false;
        }
      })();
    }, 600);
    return () => clearTimeout(t);
  }, [note.title, filePath, isSession, store]);

  return (
    <div className="note-doc">
      {note.session && <SessionMetaBanner session={note.session} />}
      <NoteMetaBlocks
        blocks={note.metaBlocks ?? []}
        templates={templates}
        onChange={setMetaBlocks}
      />
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
          <button className="note-promote" title="사이드바에 표시" onClick={() => void promote()}>
            <Icon name="folder" />
            사이드바에 보이기
          </button>
        )}
        {/* 개요: 목차 + 연결 + 백링크 for this note (collapsed by default) */}
        {metaCount > 0 && (
          <button
            className={`note-info-btn${infoOpen ? ' open' : ''}`}
            title={`개요 — 목차${tocCount ? ` ${tocCount}개` : ''}${nodeLinkCount ? ` · 노드 ${nodeLinkCount}개` : ''}${backlinks.length ? ` · 백링크 ${backlinks.length}개` : ''}`}
            onClick={() => setInfoOpen((o) => !o)}
          >
            <Icon name={infoOpen ? 'chevronDown' : 'chevronRight'} />
            개요
            <span className="note-info-count">{metaCount}</span>
          </button>
        )}
        {/* session notes have an immutable node attribution — no link editing */}
        {!isSession && (
          <button className="note-link-btn" title="이 노트를 마인드맵 노드에 연결" onClick={() => setPickerOpen(true)}>
            <Icon name="link" />
            노드에 연동
          </button>
        )}
      </div>

      {infoOpen && metaCount > 0 && (
        <div className="note-info">
          {tocCount > 0 && (
            <div className="note-info-sec">
              <div className="note-info-label">목차 <span className="note-info-label-count">{tocCount}</span></div>
              <div className="note-toc-list">
                {headings.map((h, i) => (
                  <button
                    key={`${h.pos}-${i}`}
                    className={`note-toc-item lvl${h.level}`}
                    onClick={() => goHeading(h.pos)}
                  >
                    {h.text.trim() || '제목 없음'}
                  </button>
                ))}
              </div>
            </div>
          )}
          {nodeLinkCount > 0 && (
            <div className="note-info-sec">
              <div className="note-info-label">노드 연결 <span className="note-info-label-count">{nodeLinkCount}</span></div>
              <div className="note-links">
                {note.links.map((l) => (
                  <span key={`${l.mapId}:${l.nodeId}`} className="note-link-chip">
                    <button className="nlc-go" title="노드로 이동" onClick={() => void revealNode(l)}>
                      <Icon name="mindmap" />
                      <span className="nlc-text">{l.nodeText || '노드'}</span>
                    </button>
                    <button className="nlc-x" title="연결 끊기" onClick={() => unlink(l.mapId, l.nodeId)}>
                      <Icon name="close" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {backlinks.length > 0 && (
            <div className="note-info-sec">
              <div className="note-info-label">백링크 <span className="note-info-label-count">{backlinks.length}</span></div>
              <div className="note-backlinks">
                {backlinks.map((m) => (
                  <button
                    key={m.path}
                    className="note-backlink"
                    title="미리보기 · ⌘-클릭은 바로 옆에 열기"
                    onClick={(e) => peekNote(m.path, e)}
                  >
                    <Icon name="note" />
                    <span className="nlc-text">{m.title || '제목 없음'}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
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
      <NoteEditor
        key={note.id}
        body={note.body}
        onChange={setBody}
        scaffold={isSession}
        onCreateNote={isSession ? undefined : createSiblingNote}
        onReady={setEditor}
        notePath={filePath ?? undefined}
        templates={templates}
        onAddMeta={(templateId) => {
          const existing = note.metaBlocks ?? [];
          if (existing.some((b) => b.templateId === templateId)) {
            useUi.getState().toast('이미 추가된 템플릿입니다.');
            return;
          }
          setMetaBlocks([...existing, { templateId, values: {} }]);
        }}
      />
      {/* invisible: keeps the 목차 heading list / count live off the editor */}
      {editor && <NoteHeadingsProbe editor={editor} onChange={setHeadings} />}
      <ImageLightbox />
    </div>
  );
}

interface Head {
  level: number;
  text: string;
  pos: number;
}

/** Mirrors the editor's headings up to the pane so the 정보 panel can show a 목차
 *  (and the button knows whether there is one). Renders nothing. */
function NoteHeadingsProbe({ editor, onChange }: { editor: Editor; onChange: (h: Head[]) => void }) {
  const headings = useEditorState({
    editor,
    selector: ({ editor }) => {
      const items: Head[] = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === 'heading')
          items.push({ level: (node.attrs.level as number) ?? 1, text: node.textContent, pos });
        return true;
      });
      return items;
    },
    equalityFn: (a, b) =>
      !!a && !!b && a.length === b.length && a.every((x, i) => x.pos === b[i].pos && x.text === b[i].text && x.level === b[i].level),
  });
  useEffect(() => {
    onChange(headings ?? []);
  }, [headings, onChange]);
  return null;
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
      {session.goal && <div className="session-banner-goal">🎯 {session.goal}</div>}
      {session.reflect && <div className="session-banner-result">✅ {session.reflect}</div>}
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
