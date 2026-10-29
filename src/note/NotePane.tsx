import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import { NoteContext, useNote, useNoteStore, type NoteStore } from '../store/noteStore';
import { emptyNote, serializeNote } from '../io/noteFormat';
import { fileNameFromTitle } from '../io/autoName';
import { NoteEditor, forgetNoteScroll } from './NoteEditor';
import { NoteFindBar } from './NoteFindBar';
import { CollabPeers, SharedNoteBadge, type SharedNoteStatus } from './CollabPresence';
import type { NoteCollab } from './collabCaret';
import { ImageLightbox } from './ImageLightbox';
import { NodePicker } from './NodePicker';
import { NoteMetaBlocks } from './NoteMetaBlock';
import { addLinkToNoteFile, reindexFromNote, renameWikiLinks, revealNode, shouldRewriteWikiLinksOnRename } from './noteLinks';
import { useSession } from '../store/sessionStore';
import { useWorkspace, openBoardSticky, linkedNotePath } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import { useMetaStore } from '../store/metaStore';
import { useShare, useSharedNoteInfo, type ShareDocEntry, type SharedNoteInfo } from '../store/shareStore';
import { saveSharedNote } from '../store/sharedNoteSave';
import { Icon } from '../ui/Icon';
import { CommentThread } from '../ui/CommentThread';
import { useNoteCommentCount } from '../store/commentStore';
import { fileDisplayName } from '../io/fileKind';
import { fmtDuration } from '../focus/aggregate';
import { endFocusSession, closeStaleSession } from '../focus/controller';
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
  const mirrorBody = useNote((s) => s.mirrorBody);

  // ── 공유 폴더 노트(실시간 공동편집) ────────────────────────────────────────────
  // 공유 여부는 파일 경로로 조회하되, 제목 변경으로 파일 이름이 바뀌어 새 경로가 등록되기 전(스캔이 따라잡는 몇백 ms)에도
  // 같은 노트로 남도록 마지막으로 확인한 정보를 고정한다. 노트가 공유 노트면 파일의 본문은 복제 매니저가 단일 쓰기
  // 주체이므로 이 창은 본문을 저장하지 않는다(아래 자동저장·rename·flushSaves 경로 참고).
  const sharedLive = useSharedNoteInfo(filePath);
  const sharedRef = useRef<SharedNoteInfo | null>(null);
  if (sharedLive) sharedRef.current = sharedLive;
  const sharedInfo = sharedLive ?? sharedRef.current;
  const facts = useRoomFacts(sharedInfo?.roomId ?? null);
  const [collabDoc, setCollabDoc] = useState<ShareDocEntry | null>(null);
  const [docFailed, setDocFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  // 방이 사라졌는데(공유 해제·나가기) 문서를 한 번도 못 받았다면 공유 노트로 다루지 않는다(일반 노트).
  const shared = sharedInfo && (facts.status !== 'gone' || collabDoc) ? sharedInfo : null;
  const sharedRoomId = sharedInfo?.roomId ?? null;
  const sharedNoteId = sharedInfo?.noteId ?? null;
  // 공유 노트의 코멘트(노트 전체 단위) — 헤더의 "코멘트" 버튼과 스레드 팝오버. 일반 노트에는 그려지지 않는다.
  const commentCount = useNoteCommentCount(sharedRoomId, sharedNoteId);
  const commentThread = useUi((s) => s.commentThread);
  const commentOpen =
    !!shared && !!sharedRoomId && !!sharedNoteId && !!commentThread && commentThread.roomId === sharedRoomId && commentThread.anchor.kind === 'note' && commentThread.anchor.noteId === sharedNoteId;
  useEffect(() => {
    if (!sharedRoomId || !sharedNoteId || !facts.hasReplica) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const attempt = () => {
      const replica = useShare.getState().getRoom(sharedRoomId)?.replica;
      if (!replica) return; // 복제 매니저가 다시 준비되면 이 효과가 다시 돈다
      void replica.ensureNoteDoc(sharedNoteId).then(
        (entry) => {
          if (cancelled) return;
          if (entry) {
            setDocFailed(false);
            setCollabDoc((prev) => (prev?.ydoc === entry.ydoc ? prev : entry));
            return;
          }
          attempts += 1;
          if (attempts >= 8) setDocFailed(true);
          else timer = setTimeout(attempt, 1_000);
        },
        () => {
          if (!cancelled) setDocFailed(true);
        },
      );
    };
    attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [sharedRoomId, sharedNoteId, facts.hasReplica, retryTick]);
  // 문서가 정리되면(방 연결 종료) 읽기 전용으로 — 죽은 문서에 계속 쓰지 않는다.
  const [docDestroyed, setDocDestroyed] = useState(false);
  useEffect(() => {
    setDocDestroyed(false);
    if (!collabDoc) return;
    const onDestroy = () => setDocDestroyed(true);
    collabDoc.ydoc.on('destroy', onDestroy);
    return () => collabDoc.ydoc.off('destroy', onDestroy);
  }, [collabDoc]);
  // 공유 방이 다시 시작되면(폴더 이름 변경·이동, 역할 정정, 재연결) 새 Y.Doc이 만들어지고 옛 문서는 파기된다. 에디터는 만들 때의 Y.Doc에
  // 묶이므로(Tiptap useEditor는 옵션이 바뀌어도 다시 만들지 않는다) 문서가 바뀌면 에디터를 새로 마운트해야 한다 — 안 그러면 파기된 문서에
  // 계속 타이핑해 편집이 다른 참가자에게도 파일에도 가지 않는다.
  const collabEpoch = useRef<{ ydoc: ShareDocEntry['ydoc'] | null; n: number }>({ ydoc: null, n: 0 });
  if (collabDoc && collabEpoch.current.ydoc !== collabDoc.ydoc) collabEpoch.current = { ydoc: collabDoc.ydoc, n: collabEpoch.current.n + 1 };
  const sharedEnded = !!shared && (facts.status === 'gone' || docDestroyed);
  const sharedDenied = !!shared && facts.status === 'denied';
  const sharedReadOnly = sharedEnded || sharedDenied;
  const collab = useMemo<NoteCollab | undefined>(
    () =>
      shared && collabDoc
        ? {
            ydoc: collabDoc.ydoc,
            awareness: collabDoc.awareness,
            user: { participantId: facts.participantId, name: facts.displayName },
            readOnly: sharedReadOnly,
            onBody: mirrorBody,
          }
        : undefined,
    [shared, collabDoc, facts.participantId, facts.displayName, sharedReadOnly, mirrorBody],
  );
  const sharedStatus: SharedNoteStatus = sharedEnded
    ? 'ended'
    : facts.status === 'connected' || facts.status === 'connecting' || facts.status === 'denied'
      ? facts.status
      : 'offline';

  const templates = useMetaStore((s) => s.templates);
  const metaLoaded = useMetaStore((s) => s.loaded);

  useEffect(() => {
    if (!metaLoaded) void useMetaStore.getState().load();
  }, [metaLoaded]);

  // When a template is deleted, remove its orphaned blocks from the open note.
  // Guard: only run after templates are fully loaded — an empty list before load
  // would incorrectly treat every block as orphaned and wipe them all out.
  const templateIdKey = templates.map((t) => t.id).join(',');
  useEffect(() => {
    if (!metaLoaded) return;
    const { note: current, setMetaBlocks: set } = store.getState();
    if (!current.metaBlocks?.length) return;
    const ids = new Set(templateIdKey.split(',').filter(Boolean));
    const filtered = current.metaBlocks.filter((b) => ids.has(b.templateId));
    if (filtered.length !== current.metaBlocks.length) set(filtered);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateIdKey, metaLoaded, store]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // live editor (handed up from NoteEditor) + its headings, for the 목차 section
  const [editor, setEditor] = useState<Editor | null>(null);

  // ── find in note (⌘F, or a global-search result opening this note) ──────────
  // The request waits in uiStore until this pane's editor exists, then is taken
  // once — so reopening the tab later doesn't pop the bar again.
  // `gen` restarts the bar (new search-result query); `nonce` only refocuses it.
  const [find, setFind] = useState<{ query: string; gen: number; nonce: number } | null>(null);
  const noteFindReq = useUi((s) => s.noteFindReq);
  useEffect(() => {
    if (!noteFindReq || !filePath || !editor) return;
    const query = useUi.getState().takeNoteFind(filePath);
    if (query === null) return;
    // a jump to a match must not be undone by the saved-scroll restore
    if (query) forgetNoteScroll(filePath);
    // a bare ⌘F while open keeps whatever is typed in the bar and just refocuses it
    setFind((f) =>
      f && !query
        ? { ...f, nonce: f.nonce + 1 }
        : { query, gen: (f?.gen ?? 0) + 1, nonce: (f?.nonce ?? 0) + 1 },
    );
  }, [noteFindReq, filePath, editor]);
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
  // boards whose sticky(ies) reference THIS note (2026-09-07 backlink; see
  // types.ts's BoardMeta) — same "filter the workspace index" shape as the
  // wiki backlinks above, just reversed (board → note instead of note → note).
  const boardIndex = useWorkspace((s) => s.boardIndex);
  const boardBacklinks = useMemo(
    () =>
      filePath
        ? boardIndex.flatMap((m) =>
            m.noteLinks.filter((l) => linkedNotePath(noteIndex, l) === filePath).map((l) => ({ path: m.path, stickyId: l.stickyId })),
          )
        : [],
    [boardIndex, noteIndex, filePath],
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
      useUi.getState().toast('노트를 만들 수 없습니다 — 폴더 권한을 확인해 보세요');
      return null;
    }
  };

  // attached notes live in the hidden .notes/ folder; offer to promote into the tree
  const isAttached = !!filePath && filePath.includes('/.notes/');
  // templates live in the hidden .templates/ folder — not part of the mind map
  // graph, so node-linking makes no sense here (Note Templates spec §0/§4).
  const isTemplate = !!filePath && filePath.includes('/.templates/');
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
      if (shared) {
        // 공유 노트: 본문은 쓰지 않는다 — 제목(공유 문서)과 로컬 프론트매터(노드 연결·메타 블록)만 저장한다.
        const snap = store.getState();
        void saveSharedNote(filePath, snap.note, { pushTitle: snap.titleEdited, info: shared }).then((p) => {
          if (!p) return;
          // 저장하는 동안 더 고쳤다면 dirty를 남겨 다음 자동저장이 이어받게 한다.
          if (store.getState().note === snap.note) {
            markSaved(p);
            if (snap.titleEdited) store.getState().markTitleSynced();
          }
          reindexFromNote(filePath, store.getState().note);
        });
        return;
      }
      const snap = store.getState().note;
      void window.api.save(filePath, serializeNote(snap)).then((p) => {
        if (p) {
          // 저장하는 동안 더 고쳤다면 dirty를 남겨 이미 예약된 다음 자동저장이 이어받게 한다.
          if (store.getState().note === snap) markSaved(p);
          else store.setState({ filePath: p });
          // keep the workspace link index (titles/links) fresh so pickers,
          // node chips and popups reflect edits immediately
          reindexFromNote(filePath, store.getState().note);
        }
      });
    }, 800);
    return () => clearTimeout(t);
  }, [dirty, note, filePath, markSaved, store, shared]);

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
    // A non-empty title that yields no usable filename (starts with ".", or is only
    // punctuation / path-invalid chars) can't rename the .md, so the tab and sidebar
    // label silently keep the old name. Surface that instead of leaving the user
    // confused — debounced so it fires once they pause, not on every keystroke.
    // (An empty title is a transient editing state, so it's left unwarned.)
    if (!wanted && note.title.trim()) {
      const warn = setTimeout(() => {
        useUi.getState().toast('이 제목으로는 파일 이름을 만들 수 없어 탭·사이드바 이름이 그대로예요 — 다른 제목을 입력해 보세요');
      }, 800);
      return () => clearTimeout(warn);
    }
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
          // keep note↔note links pointing here: [[oldTitle]] → [[newTitle]] everywhere.
          // 다른 참가자가 바꾼 제목(공유 노트)은 그쪽이 이미 치환한다 — 여기서도 하면 같은 자리를 두 번 고쳐 중복된다.
          if (shouldRewriteWikiLinksOnRename(store.getState().remoteTitle, newTitle)) await renameWikiLinks(oldTitle, newTitle);
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
      {note.session && <SessionMetaBanner session={note.session} notePath={filePath} />}
      {/* 메타 블록은 노트 자체에 붙는 구조화 데이터라 템플릿엔 의미가 없다 — 템플릿+로
          삽입되는 건 본문 텍스트뿐이라 메타 블록은 절대 옮겨지지 않고, 삽입 대상 노트가
          이미 같은 템플릿의 메타 블록을 갖고 있으면 혼란만 준다. */}
      {!isTemplate && (
        <NoteMetaBlocks
          blocks={note.metaBlocks ?? []}
          templates={templates}
          onChange={setMetaBlocks}
        />
      )}
      <div className="note-head">
        <input
          className="note-title"
          value={note.title}
          placeholder="제목 없음"
          readOnly={isSession || sharedReadOnly}
          onChange={(e) => setTitle(e.target.value)}
        />
        {shared && <SharedNoteBadge status={sharedStatus} />}
        {shared && sharedRoomId && sharedNoteId && (
          <button
            className={`note-comment-btn${commentOpen ? ' open' : ''}${commentCount > 0 ? ' has' : ''}`}
            data-testid="note-comment-btn"
            data-comment-anchor="note"
            aria-pressed={commentOpen}
            title="이 노트에 코멘트 남기기 — 노트 전체에 대한 대화예요"
            onClick={() => {
              if (commentOpen) useUi.getState().closeCommentThread();
              else useUi.getState().openCommentThread(sharedRoomId, { kind: 'note', noteId: sharedNoteId, label: note.title });
            }}
          >
            <Icon name="comment" />
            <span>코멘트</span>
            {commentCount > 0 && <span className="note-comment-count" data-testid="note-comment-count">{commentCount}</span>}
          </button>
        )}
        {shared && collab && !sharedReadOnly && (
          <CollabPeers awareness={collab.awareness} selfParticipantId={collab.user.participantId} />
        )}
        {isTemplate && (
          <span className="note-template-badge" title="이 노트는 템플릿입니다 — 템플릿+ 로 다른 노트에 삽입할 수 있어요">
            <Icon name="template" />
            템플릿
          </span>
        )}
        {/* 공유 노트는 변경이 계속 동기화되므로 "저장됨" 대신 위의 공유 표식이 상태를 말해 준다 */}
        {!shared && (
          <span className={`note-save${dirty ? ' saving' : ''}`} title={dirty ? '저장 중' : '저장됨'}>
            {dirty ? '저장 중…' : '저장됨'}
          </span>
        )}
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
        {/* session notes have an immutable node attribution — no link editing;
            templates aren't part of the mind map graph, so linking is meaningless */}
        {!isSession && !isTemplate && (
          <button className="note-link-btn" title="이 노트를 마인드맵 노드에 연결" onClick={() => setPickerOpen(true)}>
            <Icon name="link" />
            노드에 연동
          </button>
        )}
      </div>

      {commentOpen && sharedRoomId && sharedNoteId && (
        <CommentThread
          key={`${sharedRoomId}|${sharedNoteId}`}
          roomId={sharedRoomId}
          anchor={{ kind: 'note', noteId: sharedNoteId, label: note.title }}
          anchorSelector='[data-comment-anchor="note"]'
          title={note.title || '노트'}
          toggleFromAnchor
          onClose={() => useUi.getState().closeCommentThread()}
        />
      )}

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
          {boardBacklinks.length > 0 && (
            <div className="note-info-sec">
              <div className="note-info-label">보드에서 참조됨 <span className="note-info-label-count">{boardBacklinks.length}</span></div>
              <div className="note-backlinks">
                {boardBacklinks.map((b) => (
                  <button
                    key={`${b.path}:${b.stickyId}`}
                    className="note-backlink board"
                    title="보드 열기"
                    onClick={() => void openBoardSticky(b.path, b.stickyId)}
                  >
                    <Icon name="board" />
                    <span className="nlc-text">{fileDisplayName(b.path)}</span>
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

      {shared && sharedReadOnly && (
        <div className="note-collab-notice" role="status" data-testid="note-collab-notice">
          <Icon name="userOff" />
          <span>
            {sharedDenied
              ? '이 공유 폴더에서 내보내져 더 이상 함께 편집할 수 없어요. 이 컴퓨터에 남은 파일은 그대로 있고, 여기서는 읽기만 할 수 있어요.'
              : '이 폴더의 공유가 끝나 더 이상 함께 편집할 수 없어요. 파일은 그대로 남아 있어요 — 탭을 닫았다 다시 열면 일반 노트로 편집할 수 있어요.'}
          </span>
        </div>
      )}
      {shared && !collab ? (
        <CollabLoading failed={docFailed} onRetry={() => { setDocFailed(false); setRetryTick((n) => n + 1); }} />
      ) : (
      /* key by note id so switching to another note loads its content fresh */
      <NoteEditor
        key={collab ? `${note.id}:collab:${collabEpoch.current.n}` : note.id}
        collab={collab}
        body={note.body}
        onChange={setBody}
        scaffold={isSession}
        onCreateNote={isSession ? undefined : createSiblingNote}
        onReady={setEditor}
        overlay={
          find && editor ? (
            <NoteFindBar
              key={`${find.gen}:${editor.instanceId}`}
              editor={editor}
              initialQuery={find.query}
              focusNonce={find.nonce}
              onClose={() => setFind(null)}
            />
          ) : null
        }
        notePath={filePath ?? undefined}
        templates={isTemplate ? undefined : templates}
        onAddMeta={
          isTemplate
            ? undefined
            : (templateId) => {
                const existing = note.metaBlocks ?? [];
                if (existing.some((b) => b.templateId === templateId)) {
                  useUi.getState().toast('이미 추가된 템플릿입니다.');
                  return;
                }
                setMetaBlocks([...existing, { templateId, values: {} }]);
              }
        }
      />
      )}
      {/* invisible: keeps the 목차 heading list / count live off the editor */}
      {editor && <NoteHeadingsProbe editor={editor} onChange={setHeadings} />}
      <ImageLightbox />
    </div>
  );
}

/** 공유 노트 문서가 아직 안 왔을 때의 조용한 자리표시(스켈레톤). 오래 걸리면 안내와 다시 시도를 보여 준다. */
function CollabLoading({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <div className="note-collab-skeleton" data-testid="note-collab-loading" aria-busy={!failed}>
      {failed ? (
        <div className="note-collab-failed" role="status">
          <span>공유 노트를 아직 불러오지 못했어요. 공유 폴더에 연결되면 다시 시도해 주세요.</span>
          <button className="note-collab-retry" onClick={onRetry}>
            다시 시도
          </button>
        </div>
      ) : (
        <div className="note-collab-skeleton-inner" role="status" aria-label="노트를 불러오는 중">
          <span className="sk-line" style={{ width: '46%' }} />
          <span className="sk-line" style={{ width: '92%' }} />
          <span className="sk-line" style={{ width: '78%' }} />
          <span className="sk-line" style={{ width: '86%' }} />
          <span className="sk-line" style={{ width: '54%' }} />
        </div>
      )}
    </div>
  );
}

interface RoomFacts {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'denied' | 'gone';
  participantId: string;
  displayName: string;
  hasReplica: boolean;
}

/** 방의 연결 상태·내 신원·복제 매니저 유무를 원시 값으로 구독한다(객체를 selector가 돌려주면 재렌더 루프가 난다). */
function useRoomFacts(roomId: string | null): RoomFacts {
  const key = useShare((s) => {
    const room = roomId && Object.prototype.hasOwnProperty.call(s.rooms, roomId) ? s.rooms[roomId] : undefined;
    if (!room) return `gone\u0000\u0000\u00000`;
    return `${room.status}\u0000${room.marker.participantId}\u0000${room.marker.displayName}\u0000${room.replica ? 1 : 0}`;
  });
  return useMemo(() => {
    const [status, participantId, displayName, replica] = key.split('\u0000');
    return { status: status as RoomFacts['status'], participantId, displayName, hasReplica: replica === '1' };
  }, [key]);
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
function SessionMetaBanner({ session, notePath }: { session: FocusSession; notePath: string | null }) {
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
      // orphaned session (end never stamped) — let the user close it out
      notePath ? (
        <button
          className="sess-end stale"
          title="이 세션의 종료가 기록되지 않았어요 — 지금 종료 처리합니다"
          onClick={() => void closeStaleSession(notePath)}
        >
          종료 처리
        </button>
      ) : (
        <span className="sess-running">진행 중</span>
      )
    )
  ) : null;

  return (
    <div className={`session-banner${running ? ' running' : ''}`}>
      <div className="session-banner-main">
        <Icon name="clock" />
        <span className="session-banner-title">집중</span>
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
