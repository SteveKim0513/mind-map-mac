import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../../electron/preload';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import { useSession } from '../store/sessionStore';
import { emptyDoc, serialize, newId } from '../io/formats';
import { emptyNote, serializeNote, parseNote } from '../io/noteFormat';
import { fileNameFromTitle } from '../io/autoName';
import type { NoteStore } from '../store/noteStore';
import { extractArticle } from '../note/extractArticle';
import { renameWikiLinks } from '../note/noteLinks';
import { UrlImportModal } from '../note/UrlImportModal';
import type { NoteDoc } from '../types';
import { Icon } from '../ui/Icon';
import { FocusPill } from '../focus/FocusWidget';

interface Props {
  openPaths: string[];
  activePath: string | null;
  onOpenFile: (path: string) => void;
  onRenamed: (oldPath: string, newPath: string) => void;
  onDeleted: (path: string) => void;
  onToggle: () => void;
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(0, i) : p;
}
function basename(p: string): string {
  return p.slice(p.lastIndexOf('/') + 1);
}
function displayName(node: TreeNode): string {
  return node.type === 'file' ? node.name.replace(/\.(mind|md)$/, '') : node.name;
}
function isNoteFile(node: TreeNode): boolean {
  return node.type === 'file' && node.name.endsWith('.md');
}

export function Sidebar({
  openPaths,
  activePath,
  onOpenFile,
  onRenamed,
  onDeleted,
  onToggle,
}: Props) {
  const root = useWorkspace((s) => s.root);
  const tree = useWorkspace((s) => s.tree);
  const expanded = useWorkspace((s) => s.expanded);
  const refresh = useWorkspace((s) => s.refresh);
  const choose = useWorkspace((s) => s.choose);
  const toggle = useWorkspace((s) => s.toggle);
  const setExpanded = useWorkspace((s) => s.setExpanded);
  const noteByPath = useWorkspace((s) => s.noteByPath);
  // work-log session notes have an immutable name (title = start time, fixed at
  // creation); they can't be renamed from the tree either.
  const isLocked = (path: string) => !!noteByPath(path)?.session || path.split('/').includes('work-log');

  const [selected, setSelected] = useState<{ path: string; type: 'dir' | 'file' } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; isFile: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder path, or '' = root
  const [createMenu, setCreateMenu] = useState(false);
  const [marked, setMarked] = useState<Set<string>>(new Set());

  const toggleMark = (path: string) =>
    setMarked((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  const openMarked = () => {
    marked.forEach((p) => onOpenFile(p));
    setMarked(new Set());
  };

  const deleteMarked = async () => {
    const paths = [...marked];
    const res = await window.api.message({
      message: `${paths.length}개 파일을 삭제할까요?`,
      detail: '휴지통으로 이동합니다.',
      buttons: ['삭제', '취소'],
      cancelId: 1,
    });
    if (res !== 0) return;
    for (const p of paths) {
      await window.api.remove(p);
      onDeleted(p);
    }
    await refresh();
    setMarked(new Set());
  };

  // The folder new items are created in: selected folder, or the parent of a selected file.
  const targetDir = (): string => {
    if (!selected) return root;
    return selected.type === 'dir' ? selected.path : dirname(selected.path);
  };

  const newMindmap = async () => {
    const dir = targetDir();
    const path = await window.api.createFile(dir, '제목 없음', serialize(emptyDoc()), '.mind');
    if (dir !== root) setExpanded(dir, true);
    await refresh();
    setSelected({ path, type: 'file' });
    onOpenFile(path);
    setRenaming({ path, isFile: true });
  };

  const newNote = async () => {
    const dir = targetDir();
    const path = await window.api.createFile(
      dir,
      '제목 없음',
      serializeNote(emptyNote('제목 없음')),
      '.md',
    );
    if (dir !== root) setExpanded(dir, true);
    await refresh();
    setSelected({ path, type: 'file' });
    onOpenFile(path);
    setRenaming({ path, isFile: true });
  };

  // ── URL → note: fetch the page, extract the article, save as a linked note ──
  const [urlImport, setUrlImport] = useState<{ busy: boolean; error: string | null } | null>(null);
  const importingRef = useRef(false); // synchronous guard — React state update is async

  const importNoteFromUrl = async (rawUrl: string) => {
    if (importingRef.current) return; // drop concurrent calls (key-repeat race)
    importingRef.current = true;
    setUrlImport({ busy: true, error: null });
    try {
    const res = await window.api.webFetch(rawUrl);
    if (!res.ok) {
      setUrlImport({ busy: false, error: '링크를 가져오지 못했습니다. 주소를 확인하세요.' });
      return;
    }
    const { title, markdown, siteName } = extractArticle(res.html, res.finalUrl);
    let host = res.finalUrl;
    try {
      host = new URL(res.finalUrl).host;
    } catch {
      /* keep full url */
    }
    window.api?.log?.(
      'info',
      'web',
      `extract host=${host} status=${res.status} htmlLen=${res.html.length} mdLen=${markdown.length}`,
    );
    const body =
      `[원본 링크](${res.finalUrl})\n` +
      (siteName ? `\n_${siteName}_\n` : '') +
      `\n---\n\n` +
      (markdown || '_본문을 가져오지 못했습니다. 원본 링크를 참고하세요._');
    const note: NoteDoc = { id: newId(), title: title || '링크 노트', body, links: [] };
    const fileName =
      (title || '링크 노트').replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 60) || '링크 노트';
    const dir = targetDir();
    const path = await window.api.createFile(dir, fileName, serializeNote(note), '.md');
    if (dir !== root) setExpanded(dir, true);
    await refresh();
    setSelected({ path, type: 'file' });
    onOpenFile(path);
    window.api?.log?.('info', 'web', 'imported url → note');
    setUrlImport(null);
    } finally {
      importingRef.current = false;
    }
  };

  const newFolder = async () => {
    const dir = targetDir();
    const path = await window.api.createFolder(dir, '새 폴더');
    if (dir !== root) setExpanded(dir, true);
    await refresh();
    setSelected({ path, type: 'dir' });
    setExpanded(path, true);
    setRenaming({ path, isFile: false });
  };

  const commitRename = async (node: TreeNode, draft: string) => {
    setRenaming(null);
    if (isLocked(node.path)) return; // session notes keep their start-time name
    const trimmed = draft.trim();
    if (!trimmed || trimmed === displayName(node)) return;
    // Flush pending autosaves of affected tabs before moving the file on disk,
    // so a debounced write can't land on the old path mid-rename.
    await useSession.getState().flushSaves(node.path);

    // A NOTE's identity is its frontmatter title (one-directional title→filename
    // sync). Renaming only the file would leave an open pane on the old title and
    // the sync would rename the file back — so set the TITLE first (open note via
    // its store so the pane updates; closed note on disk), then rename to match.
    if (isNoteFile(node)) {
      const tab = useSession.getState().tabs.find((t) => t.kind === 'note' && t.path === node.path);
      let oldTitle = displayName(node); // fallback: filename-derived
      if (tab) {
        oldTitle = (tab.store as NoteStore).getState().note.title;
        (tab.store as NoteStore).getState().setTitle(trimmed);
        await useSession.getState().flushSaves(node.path); // persist new title before moving
      } else {
        try {
          const note = parseNote(await window.api.readFile(node.path), trimmed);
          oldTitle = note.title;
          await window.api.save(node.path, serializeNote({ ...note, title: trimmed }));
        } catch { /* ignore — fall through to a plain rename */ }
      }
      const newPath = await window.api.rename(node.path, `${fileNameFromTitle(trimmed) ?? trimmed}.md`);
      await refresh();
      // keep note↔note links pointing here: [[oldTitle]] → [[trimmed]] everywhere
      await renameWikiLinks(oldTitle, trimmed);
      onRenamed(node.path, newPath);
      setSelected({ path: newPath, type: 'file' });
      return;
    }

    // maps + folders: rename the file/folder directly
    const newName = node.type === 'file' ? `${trimmed}.mind` : trimmed;
    const newPath = await window.api.rename(node.path, newName);
    await refresh();
    onRenamed(node.path, newPath);
    setSelected({ path: newPath, type: node.type });
  };

  const removeNode = async (node: TreeNode) => {
    const isFile = node.type === 'file';
    const res = await window.api.message({
      message: `"${displayName(node)}"${isFile ? ' 파일' : ' 폴더'}을 삭제할까요?`,
      detail: '휴지통으로 이동합니다.',
      buttons: ['삭제', '취소'],
      cancelId: 1,
    });
    if (res !== 0) return;
    await window.api.remove(node.path);
    await refresh();
    if (selected?.path === node.path) setSelected(null);
    onDeleted(node.path);
  };

  const moveInto = async (src: string, destDir: string) => {
    setDropTarget(null);
    setDragging(null);
    await useSession.getState().flushSaves(src); // avoid autosave racing the move
    const newPath = await window.api.move(src, destDir);
    if (!newPath) return; // no-op or illegal move
    if (destDir !== root) setExpanded(destDir, true);
    await refresh();
    onRenamed(src, newPath); // session follows any open tabs (file or whole folder)
    setSelected(null);
  };

  // Order a folder's children: folders, then mind maps, then notes (each name-sorted).
  const rank = (n: TreeNode) => (n.type === 'dir' ? 0 : isNoteFile(n) ? 2 : 1);
  const ordered = (nodes: TreeNode[]) => [...nodes].sort((a, b) => rank(a) - rank(b));

  // Collapsible 마인드맵 / 노트 sections (persisted) so a long list of one kind
  // doesn't push the other off-screen.
  const [folded, setFolded] = useState<{ maps: boolean; notes: boolean }>(() => {
    try {
      return { maps: false, notes: false, ...JSON.parse(localStorage.getItem('sidebarFolded') ?? '{}') };
    } catch {
      return { maps: false, notes: false };
    }
  });
  const toggleFold = (key: 'maps' | 'notes') =>
    setFolded((f) => {
      const next = { ...f, [key]: !f[key] };
      localStorage.setItem('sidebarFolded', JSON.stringify(next));
      return next;
    });

  const sectionHeader = (key: 'maps' | 'notes', label: string, count: number) => (
    <button className="tree-section" onClick={() => toggleFold(key)}>
      <Icon name={folded[key] ? 'chevronRight' : 'chevronDown'} />
      <span className="tree-section-lbl">{label}</span>
      <span className="tree-section-count">{count}</span>
    </button>
  );

  // At the root, separate maps and notes under their own collapsible headings.
  // work-log is hidden — session notes are reached via the dashboard (by date)
  // or the node's chip, and the folder would only clutter the tree.
  const renderTree = (nodes: TreeNode[]) => {
    // hide ONLY the focus-session log folder (at the workspace root) — a user's
    // own folder happening to be named "work-log" elsewhere stays visible.
    const dirs = nodes.filter((n) => n.type === 'dir' && n.path !== `${root}/work-log`);
    const maps = nodes.filter((n) => n.type === 'file' && !isNoteFile(n));
    const notes = nodes.filter((n) => isNoteFile(n));
    return (
      <>
        {renderNodes(ordered(dirs), 0)}
        {maps.length > 0 && (
          <>
            {sectionHeader('maps', '마인드맵', maps.length)}
            {!folded.maps && renderNodes(maps, 0)}
          </>
        )}
        {notes.length > 0 && (
          <>
            {sectionHeader('notes', '노트', notes.length)}
            {!folded.notes && renderNodes(notes, 0)}
          </>
        )}
      </>
    );
  };

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    ordered(nodes).map((node) => {
      const isSel = selected?.path === node.path;
      const isOpen = node.type === 'file' && openPaths.includes(node.path);
      const isActiveFile = node.type === 'file' && node.path === activePath;
      const isRenaming = renaming?.path === node.path;
      const isMarked = marked.has(node.path);
      const pad = 8 + depth * 14;

      const isDropInto = dropTarget === node.path && node.type === 'dir';

      return (
        <div key={node.path}>
          <div
            className={`row${isSel ? ' selected' : ''}${isOpen ? ' open' : ''}${
              isActiveFile ? ' active-file' : ''
            }${isMarked ? ' marked' : ''}${isDropInto ? ' drop-into' : ''}${
              dragging === node.path ? ' dragging' : ''
            }`}
            style={{ paddingLeft: pad }}
            draggable={!renaming && !isLocked(node.path)}
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', node.path);
              setDragging(node.path);
            }}
            onDragEnd={() => {
              setDragging(null);
              setDropTarget(null);
            }}
            onDragOver={
              node.type === 'dir'
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    e.dataTransfer.dropEffect = 'move';
                    if (dropTarget !== node.path) setDropTarget(node.path);
                  }
                : undefined
            }
            onDrop={
              node.type === 'dir'
                ? (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const src = e.dataTransfer.getData('text/plain');
                    if (src) void moveInto(src, node.path);
                  }
                : undefined
            }
            onClick={(e) => {
              if (node.type === 'dir') {
                setSelected({ path: node.path, type: 'dir' });
                toggle(node.path);
              } else if (e.metaKey || e.ctrlKey) {
                // ⌘/Ctrl+click → toggle multi-selection (don't open)
                toggleMark(node.path);
              } else {
                setMarked(new Set());
                setSelected({ path: node.path, type: 'file' });
                onOpenFile(node.path);
              }
            }}
          >
            <span className="twisty">
              {node.type === 'dir' && (
                <Icon name={expanded[node.path] ? 'chevronDown' : 'chevronRight'} />
              )}
            </span>
            <span
              className={`ficon ficon--${
                node.type === 'dir' ? 'dir' : isNoteFile(node) ? 'note' : 'map'
              }`}
            >
              <Icon name={node.type === 'dir' ? 'folder' : isNoteFile(node) ? 'note' : 'mindmap'} />
            </span>

            {isRenaming ? (
              <RenameInput
                initial={displayName(node)}
                onCommit={(draft) => commitRename(node, draft)}
                onCancel={() => setRenaming(null)}
              />
            ) : (
              <span className="label">{displayName(node)}</span>
            )}

            <span className="row-actions">
              {!isLocked(node.path) && (
                <button
                  className="row-act"
                  title="이름 변경"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming({ path: node.path, isFile: node.type === 'file' });
                  }}
                >
                  <Icon name="edit" />
                </button>
              )}
              <button
                className="row-act"
                title="삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeNode(node);
                }}
              >
                <Icon name="trash" />
              </button>
            </span>
          </div>

          {node.type === 'dir' && expanded[node.path] && node.children && (
            <div>{renderNodes(node.children, depth + 1)}</div>
          )}
        </div>
      );
    });

  return (
    <div className="sidebar">
      <div className="sb-head">
        <button className="sb-ws" title="워크스페이스 폴더 변경" onClick={() => void choose()}>
          <span className="sb-ws-name">{root ? basename(root) : '워크스페이스'}</span>
          <Icon name="chevronDown" />
        </button>
        <button className="sb-collapse" title="사이드바 숨기기" onClick={onToggle}>
          <Icon name="chevronLeft" />
        </button>
      </div>

      {/* search is the entry point — opens workspace-wide search */}
      <button className="sb-search" onClick={() => useUi.getState().setGlobalSearch(true)}>
        <Icon name="search" />
        <span>검색</span>
      </button>

      {/* smart items: plan (오늘) ↔ reflect (돌아보기), pinned above the library */}
      <div className="sb-smart">
        <button className="sb-smart-item" onClick={() => useUi.getState().openToday()}>
          <Icon name="calendar" />
          <span>오늘</span>
        </button>
        <button className="sb-smart-item" onClick={() => useUi.getState().openHistory()}>
          <Icon name="clock" />
          <span>돌아보기</span>
        </button>
      </div>

      {marked.size > 0 && (
        <div className="sel-bar">
          <span className="sel-count">{marked.size}개 선택</span>
          <button className="sel-act" onClick={openMarked}>
            열기
          </button>
          <button className="sel-act danger" onClick={() => void deleteMarked()}>
            삭제
          </button>
          <button className="sel-act" onClick={() => setMarked(new Set())}>
            해제
          </button>
        </div>
      )}

      <div
        className={`tree${dropTarget === '' ? ' drop-root' : ''}`}
        onClick={() => setSelected(null)}
        onDragOver={(e) => {
          if (!dragging) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dropTarget !== '') setDropTarget('');
        }}
        onDrop={(e) => {
          e.preventDefault();
          const src = e.dataTransfer.getData('text/plain');
          if (src) void moveInto(src, root);
        }}
      >
        <div onClick={(e) => e.stopPropagation()}>
          {tree.length === 0 ? (
            <div className="tree-empty">위 ＋ 마인드맵 / 노트로 시작하세요</div>
          ) : (
            renderTree(tree)
          )}
        </div>
      </div>

      <div className="sb-foot">
        <FocusPill docked />
        <div className="sb-foot-bar">
          <div className="sb-create-wrap">
            <button
              className={`sb-foot-btn${createMenu ? ' on' : ''}`}
              title="새로 만들기"
              onClick={() => setCreateMenu((v) => !v)}
            >
              <Icon name="plus" />
            </button>
            {createMenu && (
              <>
                <div className="ctx-backdrop" onMouseDown={() => setCreateMenu(false)} />
                <div className="sb-create-menu">
                  <button onClick={() => { setCreateMenu(false); void newMindmap(); }}>
                    <Icon name="mindmap" /> 마인드맵
                  </button>
                  <button onClick={() => { setCreateMenu(false); void newNote(); }}>
                    <Icon name="note" /> 노트
                  </button>
                  <button onClick={() => { setCreateMenu(false); setUrlImport({ busy: false, error: null }); }}>
                    <Icon name="link" /> 링크로 노트
                  </button>
                  <button onClick={() => { setCreateMenu(false); void newFolder(); }}>
                    <Icon name="folder" /> 새 폴더
                  </button>
                </div>
              </>
            )}
          </div>
          <span className="sb-foot-grow" />
          <button className="sb-foot-btn" title="설정 (⌘,)" onClick={() => useUi.getState().openSettings()}>
            <Icon name="settings" />
          </button>
        </div>
      </div>

      {urlImport && (
        <UrlImportModal
          busy={urlImport.busy}
          error={urlImport.error}
          onSubmit={(url) => void importNoteFromUrl(url)}
          onClose={() => setUrlImport(null)}
        />
      )}
    </div>
  );
}


function RenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (draft: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initial);
  const done = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save) onCommit(value);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      className="rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
    />
  );
}
