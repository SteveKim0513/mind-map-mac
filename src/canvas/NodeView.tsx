import { useEffect, useRef } from 'react';
import type { PositionedNode } from '../types';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { measureNode } from '../layout/measure';
import { Icon } from '../ui/Icon';

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
  const mapStore = useMapStore();
  const isMatch = useUi((s) => s.matchIds.includes(node.id));
  const isActiveMatch = useUi((s) => s.activeMatchId === node.id);

  const hasChildren = node.children.length > 0;

  // measure the node's full footprint (box + chips/badges) so the layout can
  // reserve real space to its right and below — never overlapping neighbours.
  const rootRef = useRef<HTMLDivElement>(null);
  // signature of accessory-bearing fields: when these change the chip row
  // grows/shrinks, so we must re-measure (a ResizeObserver on the box alone
  // wouldn't fire — the chips live outside it).
  const metaSig = `${node.note ? 1 : 0}|${node.link ? 1 : 0}|${node.scheduled ? 1 : 0}|${
    node.scheduleAt ?? ''
  }|${p.childDone}/${p.childTotal}|${node.collapsed ? p.hiddenCount : 0}`;
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
    el.querySelectorAll<HTMLElement>('.node-meta').forEach((c) => ro.observe(c));
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, onMeasure, metaSig]);

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
    (style as Record<string, string>)['--tint-bg'] =
      `color-mix(in srgb, ${node.color} 13%, var(--surface))`;
    (style as Record<string, string>)['--tint-border'] =
      `color-mix(in srgb, ${node.color} 40%, var(--hairline))`;
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
        // keep an existing multi-selection if right-clicking one of its members
        const sel = mapStore.getState().selectedIds;
        if (!(sel.length > 1 && sel.includes(node.id))) select(node.id);
        useUi.getState().openContextMenu(node.id, e.clientX, e.clientY);
      }}
    >
      {node.icon && <span className="icon">{node.icon}</span>}

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
        <span className="text">{node.text || ' '}</span>
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

      {!editing && (node.link || node.note || node.scheduled) && (
        <div className="node-meta" onPointerDown={(e) => e.stopPropagation()}>
          {node.scheduled && (
            <button
              className={`meta-pill sched${node.reminderOn ? ' reminding' : ''}`}
              title={
                node.scheduleAt
                  ? `${fmtSchedule(node.scheduleAt)}${node.reminderOn ? ' · 미리알림' : ''}`
                  : '스케줄 설정'
              }
              onClick={(e) => {
                e.stopPropagation();
                select(node.id);
                useUi.getState().openSchedule(node.id);
              }}
            >
              <span className="meta-pi">
                <Icon name={node.reminderOn ? 'alarm' : 'calendar'} />
              </span>
              {node.scheduleAt && <span className="meta-pt">{fmtSchedule(node.scheduleAt)}</span>}
            </button>
          )}
          {node.note && (
            <button
              className="meta-pill note icon-only"
              title={node.note}
              onClick={(e) => {
                e.stopPropagation();
                select(node.id);
                useUi.getState().openNote(node.id);
              }}
            >
              <span className="meta-pi">
                <Icon name="note" />
              </span>
            </button>
          )}
          {node.link && (
            <button
              className="meta-pill link"
              title={node.link}
              onClick={(e) => {
                e.stopPropagation();
                window.open(node.link, '_blank');
              }}
            >
              <span className="meta-pi">
                <Icon name="link" />
              </span>
              {!node.note && <span className="meta-pt">{hostOf(node.link)}</span>}
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

/** Compact local date/time label for a schedule badge, e.g. "6/15 09:00". */
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

  // set initial text, focus, and select all on mount
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
        // Enter commits; Shift+Enter inserts a newline.
        // Stop native propagation BEFORE finish(): committing re-renders synchronously
        // (zustand) and unmounts this element, so the window keydown listener would
        // otherwise fire afterwards and create an extra sibling.
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
        // stop global shortcuts (Tab, arrows, Delete) from firing while typing
        e.stopPropagation();
      }}
    />
  );
}
