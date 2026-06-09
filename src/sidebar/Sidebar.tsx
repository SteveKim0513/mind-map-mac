import { useEffect, useRef, useState } from 'react';
import type { TreeNode } from '../../electron/preload';
import { useWorkspace } from '../store/workspaceStore';
import { useUi } from '../store/uiStore';
import { emptyDoc, serialize } from '../io/formats';

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
  return node.type === 'file' ? node.name.replace(/\.mind$/, '') : node.name;
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

  const [selected, setSelected] = useState<{ path: string; type: 'dir' | 'file' } | null>(null);
  const [renaming, setRenaming] = useState<{ path: string; isFile: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null); // folder path, or '' = root
  const [showHelp, setShowHelp] = useState(false);
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const theme = useUi((s) => s.theme);
  const fontScale = useUi((s) => s.fontScale);

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

  const newFile = async () => {
    const dir = targetDir();
    const path = await window.api.createFile(dir, '제목 없음', serialize(emptyDoc()));
    if (dir !== root) setExpanded(dir, true);
    await refresh();
    setSelected({ path, type: 'file' });
    onOpenFile(path);
    setRenaming({ path, isFile: true });
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
    const trimmed = draft.trim();
    if (!trimmed || trimmed === displayName(node)) return;
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
    const newPath = await window.api.move(src, destDir);
    if (!newPath) return; // no-op or illegal move
    if (destDir !== root) setExpanded(destDir, true);
    await refresh();
    onRenamed(src, newPath); // session follows any open tabs (file or whole folder)
    setSelected(null);
  };

  const renderNodes = (nodes: TreeNode[], depth: number) =>
    nodes.map((node) => {
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
            draggable={!renaming}
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
              {node.type === 'dir' ? (expanded[node.path] ? '▾' : '▸') : ''}
            </span>
            <span className="ficon">{node.type === 'dir' ? '📁' : '🗒'}</span>

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
              <button
                className="row-act"
                title="이름 변경"
                onClick={(e) => {
                  e.stopPropagation();
                  setRenaming({ path: node.path, isFile: node.type === 'file' });
                }}
              >
                ✎
              </button>
              <button
                className="row-act"
                title="삭제"
                onClick={(e) => {
                  e.stopPropagation();
                  void removeNode(node);
                }}
              >
                🗑
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
      <div className="sidebar-top">
        <button className="ws-name" title="워크스페이스 폴더 변경" onClick={() => void choose()}>
          📂 {root ? basename(root) : '워크스페이스'}
        </button>
        <button className="collapse-sidebar" title="사이드바 숨기기" onClick={onToggle}>
          ⟨
        </button>
      </div>

      <div className="sidebar-actions">
        <button className="tool-btn" onClick={() => void newFile()}>
          ＋ 파일
        </button>
        <button className="tool-btn" onClick={() => void newFolder()}>
          ＋ 폴더
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
            <div className="tree-empty">＋ 파일로 첫 마인드맵을 만드세요</div>
          ) : (
            renderNodes(tree, 0)
          )}
        </div>
      </div>

      <div className="sidebar-foot">
        {showHelp && (
          <div className="settings-panel">
            <div className="settings-row">
              <span className="settings-label">테마</span>
              <div className="seg">
                <button
                  className={`seg-btn${theme === 'light' ? ' on' : ''}`}
                  onClick={() => useUi.getState().setTheme('light')}
                >
                  ☀ 라이트
                </button>
                <button
                  className={`seg-btn${theme === 'dark' ? ' on' : ''}`}
                  onClick={() => useUi.getState().setTheme('dark')}
                >
                  ☾ 다크
                </button>
              </div>
            </div>

            <div className="settings-row">
              <span className="settings-label">글자 크기</span>
              <div className="fs-stepper">
                <button className="fs-btn" title="작게" onClick={() => useUi.getState().setFontScale(fontScale - 0.1)}>
                  A−
                </button>
                <span className="fs-val">{Math.round(fontScale * 100)}%</span>
                <button className="fs-btn" title="크게" onClick={() => useUi.getState().setFontScale(fontScale + 0.1)}>
                  A+
                </button>
              </div>
            </div>

            <div className="settings-sub">단축키</div>
            <div className="help-panel">
              <Row k="Tab" d="자식 노드" />
              <Row k="Enter" d="형제 노드" />
              <Row k="Space" d="편집" />
              <Row k="Delete" d="삭제" />
              <Row k="↑ ↓ ← →" d="노드 이동" />
              <Row k="⌘← ⌘→" d="접기 / 펼치기" />
              <Row k="⌥↑ ⌥↓" d="순서 바꾸기" />
              <Row k="Z" d="노드로 확대" />
              <Row k="Shift+클릭" d="다중 선택" />
              <Row k="⌘C ⌘V" d="복사 / 붙여넣기" />
              <Row k="⌘Enter" d="완료 표시" />
              <Row k="⌘F" d="검색" />
              <Row k="⌘P / ⌘K" d="빠른 열기 / 명령" />
              <Row k="우클릭" d="노드 메뉴" />
              <Row k="더블클릭" d="새 중심 주제" />
            </div>
          </div>
        )}
        <button className="help-toggle" onClick={() => setShowHelp((v) => !v)}>
          <span>⚙ 설정</span>
          <span>{showHelp ? '▾' : '▸'}</span>
        </button>
      </div>
    </div>
  );
}

function Row({ k, d }: { k: string; d: string }) {
  return (
    <div className="help-row">
      <kbd>{k}</kbd>
      <span>{d}</span>
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
