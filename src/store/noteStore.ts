import { createContext, useContext } from 'react';
import { createStore, useStore, type StoreApi } from 'zustand';
import type { FocusSession, NoteDoc, NoteLink, NoteMetaBlock } from '../types';
import { emptyNote } from '../io/noteFormat';

interface NoteState {
  note: NoteDoc;
  filePath: string | null;
  dirty: boolean;
  /**
   * 공유 폴더 노트: 다른 참가자가 바꾼 제목을 마지막으로 반영한 값(없으면 null). NotePane의 제목→파일명 동기화가
   * "이 제목 변경은 원격에서 왔다"를 알아 `[[위키링크]]` 일괄 치환을 건너뛰게 한다(참가자마다 치환하면 중복된다).
   */
  remoteTitle: string | null;
  /** 제목을 로컬에서 고쳤고 아직 공유 문서(manifest)에 보내지 않았다 — 공유 노트에서만 의미가 있다. */
  titleEdited: boolean;

  loadNote: (note: NoteDoc, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
  /** 공유 노트: 제목을 공유 문서로 보냈다. */
  markTitleSynced: () => void;
  setFilePath: (filePath: string) => void;

  setTitle: (title: string) => void;
  setBody: (body: string) => void;
  /** 공유 노트: 화면 상태의 본문만 맞춘다(dirty 아님 — 파일은 복제 매니저가 쓴다). */
  mirrorBody: (body: string) => void;
  /** 공유 노트: 원격에서 바뀐 제목을 반영한다(dirty 아님). 로컬에서 고친 제목이 아직 안 나갔으면 무시한다 — 로컬 값이 이긴다. */
  setTitleFromShare: (title: string) => void;
  applySession: (session: FocusSession) => void; // system write (focus end) — never user-editable
  addLink: (link: NoteLink) => void;
  removeLink: (mapId: string, nodeId: string) => void;
  updateLinkText: (mapId: string, nodeId: string, nodeText: string) => void;
  setMetaBlocks: (blocks: NoteMetaBlock[]) => void;
}

export type NoteStore = StoreApi<NoteState>;

export function createNoteStore(): NoteStore {
  return createStore<NoteState>((set, get) => ({
    note: emptyNote(),
    filePath: null,
    dirty: false,
    remoteTitle: null,
    titleEdited: false,

    loadNote: (note, filePath) => set({ note, filePath, dirty: false, remoteTitle: null, titleEdited: false }),
    markSaved: (filePath) => set({ filePath, dirty: false }),
    markTitleSynced: () => set({ titleEdited: false }),
    setFilePath: (filePath) => set({ filePath }),

    // Strip C0 control characters (incl. a literal backspace, which a paste can
    // insert as real text rather than deleting anything) — an unfiltered one
    // flows straight into the file name via note-title-filename-sync and
    // produces an invisible, hard-to-select prefix on the actual file.
    setTitle: (title) =>
      set({ note: { ...get().note, title: title.replace(/[\x00-\x1f\x7f]/g, '') }, dirty: true, titleEdited: true }),
    setBody: (body) => set({ note: { ...get().note, body }, dirty: true }),
    mirrorBody: (body) => {
      if (get().note.body !== body) set({ note: { ...get().note, body } });
    },
    setTitleFromShare: (title) => {
      const st = get();
      if (st.titleEdited || st.note.title === title) return;
      set({ note: { ...st.note, title }, remoteTitle: title });
    },
    // keep an open session note's meta in sync after the app stamps end — does
    // NOT set dirty (disk already written), so a later autosave keeps the new end.
    applySession: (session) => set({ note: { ...get().note, session } }),

    addLink: (link) => {
      const { note } = get();
      if (note.links.some((l) => l.mapId === link.mapId && l.nodeId === link.nodeId)) return;
      set({ note: { ...note, links: [...note.links, link] }, dirty: true });
    },
    removeLink: (mapId, nodeId) => {
      const { note } = get();
      set({
        note: { ...note, links: note.links.filter((l) => !(l.mapId === mapId && l.nodeId === nodeId)) },
        dirty: true,
      });
    },
    // IF-05 · refresh the cached chip label after the linked node's text changed.
    updateLinkText: (mapId, nodeId, nodeText) => {
      const { note } = get();
      let changed = false;
      const links = note.links.map((l) => {
        if (l.mapId === mapId && l.nodeId === nodeId && l.nodeText !== nodeText) {
          changed = true;
          return { ...l, nodeText };
        }
        return l;
      });
      if (changed) set({ note: { ...note, links }, dirty: true });
    },
    setMetaBlocks: (metaBlocks) =>
      set({ note: { ...get().note, metaBlocks }, dirty: true }),
  }));
}

// ── React context: components read the note store of the pane they render in ──
export const NoteContext = createContext<NoteStore | null>(null);

export function useNoteStore(): NoteStore {
  const store = useContext(NoteContext);
  if (!store) throw new Error('useNoteStore must be used within a NoteContext.Provider');
  return store;
}

export function useNote<T>(selector: (s: NoteState) => T): T {
  return useStore(useNoteStore(), selector);
}
