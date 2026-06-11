import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { PositionedNode } from '../types';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { useWorkspace } from '../store/workspaceStore';
import { measureNode } from '../layout/measure';
import { scheduleInfo } from './scheduleInfo';
import { Icon, isIconName } from '../ui/Icon';
import { tagVar } from '../theme/palette';

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
  const toggleCollapse = useMap((s) => s.toggleCollapse);
  const addChild = useMap((s) => s.addChild);
  const removeNodeLink = useMap((s) => s.removeNodeLink);
  const setNote = useMap((s) => s.setNote);
  const mapStore = useMapStore();
  const isMatch = useUi((s) => s.matchIds.includes(node.id));
  const isActiveMatch = useUi((s) => s.activeMatchId === node.id);
  const memoEditing = useUi((s) => s.memoEditFor === node.id);

  // notes linked to this node (resolved from the workspace link index)
  const docId = useMap((s) => s.doc.id);
  const noteIndex = useWorkspace((s) => s.noteIndex);
  const linkedNotes = useMemo(
    () =>
      docId
        ? noteIndex.filter((m) => m.links.some((l) => l.mapId === docId && l.nodeId === node.id))
        : [],
    [noteIndex, docId, node.id],
  );
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
  }|${p.childDone}/${p.childTotal}|${node.collapsed ? p.hiddenCount : 0}|${linkedNotes.length}|${allLinks.length}|${memoTitles}`;
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
    node.done ? 'done' : '',
    node.scheduled ? 'scheduled' : '',
    isMatch ? 'match' : '',
    isActiveMatch ? 'active-match' : '',
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
        startEdit(node.id);
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
      {!editing && (node.note || memoEditing) && (
        <NodeMemo
          key={memoEditing ? 'edit' : 'view'}
          initial={node.note ?? ''}
          autoFocus={memoEditing}
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

      {/* ②③ STATUS GUTTER — one compact row: schedule (urgency) · links · notes */}
      {!editing && (sched || allLinks.length > 0 || linkedNotes.length > 0) && (
        <div className="node-gutter" onPointerDown={(e) => e.stopPropagation()}>
          {sched && (
            <button
              className={`gchip sched urg-${sched.urg}${node.reminderOn ? ' reminding' : ''}`}
              title={node.scheduleAt ? fmtSchedule(node.scheduleAt) : '스케줄 설정'}
              onClick={(e) => {
                e.stopPropagation();
                select(node.id);
                useUi.getState().openSchedule(node.id);
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
                  window.open(url, '_blank');
                }}
              >
                <Icon name="link" />
                <span className="gchip-t">{hostOf(url)}</span>
              </button>
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

      {!editing && (
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
  onCommit,
}: {
  initial: string;
  autoFocus: boolean;
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
      contentEditable
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
