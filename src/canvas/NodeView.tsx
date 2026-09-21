import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { PositionedNode } from '../types';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { useWorkspace, openBoardSticky } from '../store/workspaceStore';
import { measureNode } from '../layout/measure';
import { scheduleInfo } from './scheduleInfo';
import { fmtDuration } from '../focus/aggregate';
import { Icon, isIconName } from '../ui/Icon';
import { tagVar } from '../theme/palette';
import { fileDisplayName } from '../io/fileKind';
import { safeExternalUrl } from '../io/linkSafety';
import { useCommentFileTarget, useTargetCommentCount } from '../store/commentStore';

interface Props {
  p: PositionedNode;
  isRoot: boolean;
  selected: boolean;
  editing: boolean;
  isDropTarget: boolean;
  isDragging: boolean;
  onPointerDown: (id: string, e: React.PointerEvent) => void;
  onMeasure: (id: string, width: number, height: number, below: number) => void;
}

export function NodeView({
  p,
  isRoot,
  selected,
  editing,
  isDropTarget,
  isDragging,
  onPointerDown,
  onMeasure,
}: Props) {
  const { node } = p;
  const select = useMap((s) => s.select);
  const toggleSelect = useMap((s) => s.toggleSelect);
  const startEdit = useMap((s) => s.startEdit);
  const commitText = useMap((s) => s.commitText);
  const cancelEdit = useMap((s) => s.cancelEdit);
  const deleteNode = useMap((s) => s.deleteNode);
  const toggleDone = useMap((s) => s.toggleDone);
  const toggleCollapse = useMap((s) => s.toggleCollapse);
  const addChild = useMap((s) => s.addChild);
  const removeNodeLink = useMap((s) => s.removeNodeLink);
  const setNote = useMap((s) => s.setNote);
  const mapStore = useMapStore();
  // 공유로 받은 읽기 전용 맵(뷰어): 편집 어포던스를 숨기고 눌러도 아무 일도 없게 한다(스토어도 모든 변경을 차단한다).
  const readOnly = useMap((s) => s.readOnly);
  const isMatch = useUi((s) => s.matchIds.includes(node.id));
  const isActiveMatch = useUi((s) => s.activeMatchId === node.id);
  const memoEditing = useUi((s) => s.memoEditFor === node.id);
  // 공유 폴더의 코멘트(소유자·참가자 모두, 뷰어 포함): 코멘트가 달린 노드에는 개수 칩이 붙는다. 일반(비공유) 파일에는 아무것도 그려지지 않는다.
  const filePath = useMap((s) => s.filePath);
  const commentTarget = useCommentFileTarget(filePath);
  const commentCount = useTargetCommentCount(commentTarget, node.id);

  // notes linked to this node (resolved from the workspace link index)
  const docId = useMap((s) => s.doc.id);
  const activeFocus = useUi((s) => s.activeFocus);
  const isFocusing = !!activeFocus && activeFocus.mapId === docId && activeFocus.nodeId === node.id;
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const linkedNotes = useMemo(
    () =>
      docId
        ? noteIndex.filter((m) => m.links.some((l) => l.mapId === docId && l.nodeId === node.id))
        : [],
    [noteIndex, docId, node.id],
  );
  // boards whose sticky(ies) reference this node (2026-09-07 backlink; see
  // types.ts's BoardMeta) — same "filter the workspace index" shape as
  // linkedNotes above, just reversed (board → node instead of note → node).
  const boardIndex = useWorkspace((s) => s.boardIndex);
  const linkedBoards = useMemo(
    () =>
      docId
        ? boardIndex.flatMap((m) =>
            m.nodeLinks
              .filter((l) => l.link.mapId === docId && l.link.nodeId === node.id)
              .map((l) => ({ path: m.path, stickyId: l.stickyId })),
          )
        : [],
    [boardIndex, docId, node.id],
  );
  // cumulative focus time on this node + its whole subtree — computed against the
  // CURRENT tree (live descendant set), so moving a node re-attributes its time.
  const nodes = useMap((s) => s.doc.nodes);
  const focusStat = useMemo(() => {
    if (!docId) return null;
    // live descendant set (includes self) from the current structure
    const subtree = new Set<string>([node.id]);
    const stack = [node.id];
    while (stack.length) {
      const id = stack.pop()!;
      for (const c of nodes[id]?.children ?? []) if (!subtree.has(c)) { subtree.add(c); stack.push(c); }
    }
    let sec = 0;
    let count = 0;
    for (const m of noteIndex) {
      const s = m.session;
      if (!s || s.end == null || s.durationSec <= 0 || s.link.mapId !== docId) continue;
      if (!subtree.has(s.link.nodeId)) continue;
      sec += s.durationSec;
      if (s.link.nodeId === node.id) count++;
    }
    return sec > 0 ? { sec, count } : null;
  }, [noteIndex, docId, node.id, nodes]);

  // legacy single link + new multi links, de-duplicated
  const allLinks = useMemo(() => {
    const out: string[] = [];
    if (node.link) out.push(node.link);
    for (const u of node.links ?? []) if (!out.includes(u)) out.push(u);
    return out;
  }, [node.link, node.links]);

  const sched = node.scheduled ? scheduleInfo(node.scheduleAt) : null;
  const hasChildren = node.children.length > 0;

  // measure the node's full footprint (box + memo + gutter) so the layout can
  // reserve real space and never let a neighbour overlap it.
  const rootRef = useRef<HTMLDivElement>(null);
  const memoTitles = linkedNotes.map((m) => m.title).join('');
  const metaSig = `${node.note ? 1 : 0}|${memoEditing ? 1 : 0}|${sched?.label ?? ''}|${
    sched?.urg ?? ''
  }|${p.childDone}/${p.childTotal}|${node.collapsed ? p.hiddenCount : 0}|${linkedNotes.length}|${allLinks.length}|${memoTitles}|${focusStat?.sec ?? 0}|${linkedBoards.length}|${commentCount}`;
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const report = () => {
      const m = measureNode(el);
      onMeasure(node.id, m.w, m.h, m.below);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    el.querySelectorAll<HTMLElement>('.node-gutter').forEach((c) => ro.observe(c));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, onMeasure, metaSig]);

  // ── FLIP: glide to a new layout position instead of jumping ────────────────
  const prevPos = useRef<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const prev = prevPos.current;
    prevPos.current = { x: p.x, y: p.y };
    // No glide while the user is typing in this node — their own keystrokes
    // resize it and re-center it, and a spring per line-wrap shakes the caret.
    if (!prev || isDragging || editing || memoEditing) return;
    const dx = prev.x - p.x;
    const dy = prev.y - p.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
    el.style.transition = 'none';
    el.style.transform = `translate(${dx}px, ${dy}px) translateY(-50%)`;
    requestAnimationFrame(() => {
      el.style.transition = 'transform 0.28s var(--spring)';
      el.style.transform = '';
    });
  }, [p.x, p.y, isDragging, editing, memoEditing]);

  const cls = [
    'node',
    isRoot ? 'root' : '',
    node.color ? 'tinted' : '',
    selected ? 'selected' : '',
    editing ? 'editing' : '',
    isDropTarget ? 'drop-target' : '',
    isDragging ? 'dragging' : '',
    node.todo ? 'todo' : '',
    node.done ? 'done' : '',
    readOnly ? 'viewer' : '',
    node.scheduled ? 'scheduled' : '',
    isMatch ? 'match' : '',
    isActiveMatch ? 'active-match' : '',
    isFocusing ? 'focusing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const style: React.CSSProperties = { left: p.x, top: p.y };
  if (node.color) {
    const tint = tagVar(node.color);
    (style as Record<string, string>)['--tint-bg'] = `color-mix(in srgb, ${tint} 13%, var(--surface))`;
    (style as Record<string, string>)['--tint-border'] = `color-mix(in srgb, ${tint} 40%, var(--hairline))`;
  }

  return (
    <div
      ref={rootRef}
      data-node-id={node.id}
      className={cls}
      style={style}
      onPointerDown={(e) => {
        if (editing) return;
        onPointerDown(node.id, e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (editing) return;
        if (e.shiftKey) toggleSelect(node.id);
        else select(node.id);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!readOnly) startEdit(node.id);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const sel = mapStore.getState().selectedIds;
        if (!(sel.length > 1 && sel.includes(node.id))) select(node.id);
        useUi.getState().openContextMenu(node.id, e.clientX, e.clientY);
      }}
    >
      {/* title row */}
      <div className="node-line">
        {node.todo && !editing && (
          <button
            className={`node-check${node.done ? ' done' : ''}`}
            title={readOnly ? (node.done ? '완료됨' : '할 일') : node.done ? '완료 해제' : '완료'}
            disabled={readOnly}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              if (!readOnly) toggleDone(node.id);
            }}
          >
            {node.done && <Icon name="check" />}
          </button>
        )}
        {node.icon && (
          <span className="icon">{isIconName(node.icon) ? <Icon name={node.icon} /> : node.icon}</span>
        )}
        {editing ? (
          <NodeEditor
            initial={node.text}
            deletable={
              node.children.length === 0 &&
              (node.parentId !== null || mapStore.getState().doc.rootIds.length > 1)
            }
            onCommit={(text) => commitText(node.id, text)}
            onCancel={cancelEdit}
            onDelete={() => deleteNode(node.id)}
          />
        ) : (
          <span className="text">{node.text || ' '}</span>
        )}
      </div>

      {/* ① MEMO = the node's own body (a light inline line), not an attachment */}
      {!editing && (node.note || (memoEditing && !readOnly)) && (
        <NodeMemo
          key={memoEditing ? 'edit' : 'view'}
          initial={node.note ?? ''}
          autoFocus={memoEditing && !readOnly}
          readOnly={readOnly}
          onCommit={(t) => {
            setNote(node.id, t.trim());
            if (memoEditing) useUi.getState().setMemoEditFor(null);
          }}
        />
      )}

      {!editing && p.childTotal > 0 && p.childDone > 0 && (
        <span className="progress-badge" title={`${p.childDone}/${p.childTotal} 완료`}>
          {p.childDone}/{p.childTotal}
        </span>
      )}
      {node.collapsed && p.hiddenCount > 0 && (
        <span className="count-badge" title={`${p.hiddenCount}개 숨김`}>
          {p.hiddenCount}
        </span>
      )}

      {/* ②③ STATUS GUTTER — one compact row: schedule (urgency) · links · notes · focus.
          집중 통계는 실행 지표라 할 일(todo) 노드에서만 — 생각 노드로 새어나가지 않게(누수 수정). */}
      {!editing && (sched || allLinks.length > 0 || linkedNotes.length > 0 || linkedBoards.length > 0 || commentCount > 0 || (focusStat && node.todo)) && (
        <div className="node-gutter" onPointerDown={(e) => e.stopPropagation()}>
          {sched && (
            <button
              className={`gchip sched urg-${sched.urg}${node.reminderOn ? ' reminding' : ''}`}
              title={node.scheduleAt ? fmtSchedule(node.scheduleAt) : '스케줄 설정'}
              onClick={(e) => {
                e.stopPropagation();
                select(node.id);
                if (!readOnly) useUi.getState().openSchedule(node.id);
              }}
            >
              <Icon name={node.reminderOn ? 'alarm' : 'calendar'} />
              <span className="gchip-t">{sched.label}</span>
            </button>
          )}
          {allLinks.map((url) => (
            <span key={url} className="gchip link">
              <button
                className="gchip-open"
                title={url}
                onClick={(e) => {
                  e.stopPropagation();
                  // 공유로 받은 맵의 링크는 원격이 채울 수 있다 — http(s)·mailto만 연다(main도 한 번 더 막는다).
                  const safe = safeExternalUrl(url);
                  if (safe) window.open(safe, '_blank');
                  else useUi.getState().toast('열 수 없는 링크예요 — http(s)·메일 주소만 열 수 있어요');
                }}
              >
                <Icon name="link" />
                <span className="gchip-t">{hostOf(url)}</span>
              </button>
              {!readOnly && (
                <button
                  className="gchip-x"
                  title="링크 제거"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeNodeLink(node.id, url);
                  }}
                >
                  <Icon name="close" />
                </button>
              )}
            </span>
          ))}
          {linkedNotes.map((m) => (
            <button
              key={m.path}
              className="gchip note"
              title={m.title}
              onClick={(e) => {
                e.stopPropagation();
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                useUi
                  .getState()
                  .openNotePopup(
                    [m.path],
                    { x: r.left, y: r.bottom },
                    docId ? { mapId: docId, nodeId: node.id } : undefined,
                  );
              }}
            >
              <Icon name="note" />
              <span className="gchip-t">{m.title}</span>
            </button>
          ))}
          {linkedBoards.map((b) => (
            <button
              key={`${b.path}:${b.stickyId}`}
              className="gchip board"
              title={`${fileDisplayName(b.path)} 보드에서 참조됨`}
              onClick={(e) => {
                e.stopPropagation();
                void openBoardSticky(b.path, b.stickyId);
              }}
            >
              <Icon name="board" />
              <span className="gchip-t">{fileDisplayName(b.path)}</span>
            </button>
          ))}
          {commentTarget && commentCount > 0 && (
            <button
              className="gchip comment"
              data-testid="comment-chip"
              title={`코멘트 ${commentCount}개 — 눌러서 보기`}
              aria-label={`코멘트 ${commentCount}개`}
              onClick={(e) => {
                e.stopPropagation();
                select(node.id);
                useUi.getState().openCommentThread(commentTarget.roomId, {
                  kind: 'map',
                  fileId: commentTarget.fileId,
                  targetId: node.id,
                  label: node.text,
                });
              }}
            >
              <Icon name="comment" />
              <span className="gchip-t">{commentCount}</span>
            </button>
          )}
          {focusStat && node.todo && (
            <button
              className="gchip focus"
              title={`집중 ${focusStat.count}회 · 누적 ${fmtDuration(focusStat.sec)} (하위 포함)`}
              onClick={(e) => {
                e.stopPropagation();
                useUi.getState().openHistory();
              }}
            >
              <Icon name="clock" />
              <span className="gchip-t">{fmtDuration(focusStat.sec)}</span>
            </button>
          )}
        </div>
      )}

      {hasChildren && (
        <span
          className={`collapse-toggle${node.collapsed ? ' shown' : ''}`}
          style={{ left: '100%', top: '50%' }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            toggleCollapse(node.id);
          }}
          title={node.collapsed ? '펼치기' : '접기'}
        >
          <Icon name={node.collapsed ? 'chevronRight' : 'chevronDown'} />
        </span>
      )}

      {!editing && !readOnly && (
        <button
          className="add-child"
          style={{ left: hasChildren ? 'calc(100% + 24px)' : '100%' }}
          title="자식 추가"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            addChild(node.id);
          }}
        >
          <Icon name="plus" />
        </button>
      )}
    </div>
  );
}

/** Compact local date/time label, e.g. "6/15 09:00". */
function fmtSchedule(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  if (!hasTime) return md;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${md} ${hh}:${mm}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.length > 20 ? url.slice(0, 20) + '…' : url;
  }
}

/** Inline memo — a light second line of body text living on the node itself. */
function NodeMemo({
  initial,
  autoFocus,
  readOnly = false,
  onCommit,
}: {
  initial: string;
  autoFocus: boolean;
  /** 뷰어(공유로 받은 읽기 전용 맵) — 글자만 보이고 커서·입력이 없다. */
  readOnly?: boolean;
  onCommit: (text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initial;
    if (autoFocus) {
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={ref}
      className="node-memo"
      contentEditable={!readOnly}
      suppressContentEditableWarning
      data-placeholder="메모…"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => onCommit(e.currentTarget.textContent ?? '')}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/**
 * Inline editor based on a contentEditable span so the node box grows
 * horizontally with the text (and wraps at the node's max-width).
 */
function NodeEditor({
  initial,
  deletable,
  onCommit,
  onCancel,
  onDelete,
}: {
  initial: string;
  deletable: boolean;
  onCommit: (text: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const done = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initial;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [initial]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const text = ref.current?.textContent ?? '';
    if (save) {
      if (text.trim() === '' && deletable) onDelete();
      else onCommit(text);
    } else {
      if (initial.trim() === '' && deletable) onDelete();
      else onCancel();
    }
  };

  return (
    <div
      ref={ref}
      className="text editing-text"
      contentEditable
      suppressContentEditableWarning
      onBlur={() => finish(true)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          finish(true);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          e.nativeEvent.stopImmediatePropagation();
          finish(false);
          return;
        }
        e.stopPropagation();
      }}
    />
  );
}
