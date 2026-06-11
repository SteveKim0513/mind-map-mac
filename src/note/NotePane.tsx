import { useEffect, useRef, useState } from 'react';
import { NoteContext, useNote, useNoteStore, type NoteStore } from '../store/noteStore';
import { serializeNote } from '../io/noteFormat';
import { fileNameFromTitle } from '../io/autoName';
import { NoteEditor } from './NoteEditor';
import { NodePicker } from './NodePicker';
import { addLinkToNoteFile, reindexFromNote, revealNode } from './noteLinks';
import { useSession } from '../store/sessionStore';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from '../ui/Icon';
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
  useEffect(() => {
    if (!filePath || renaming.current) return;
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
  }, [note.title, filePath]);

  return (
    <div className="note-doc">
      <div className="note-head">
        <input
          className="note-title"
          value={note.title}
          placeholder="제목 없음"
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
        <button className="note-link-btn" title="노드에 연동" onClick={() => setPickerOpen(true)}>
          <Icon name="link" />
          연동
        </button>
      </div>

      {note.links.length > 0 && (
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
