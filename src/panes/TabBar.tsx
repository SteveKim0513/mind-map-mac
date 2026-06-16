import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useUi } from '../store/uiStore';
import { Icon } from '../ui/Icon';
import type { Tab, GroupIndex } from '../store/sessionStore';
import type { MapStore } from '../store/mapStore';
import type { NoteStore } from '../store/noteStore';

function TabDirty({ store }: { store: MapStore | NoteStore }) {
  // both map and note stores expose `dirty`
  const dirty = useStore(store as MapStore, (s) => s.dirty);
  return dirty ? <span className="tab-dirty" title="저장되지 않음" /> : null;
}

interface Props {
  tabs: Tab[];
  leftTabs: string[];
  leftActive: string | null;
  rightTabs: string[];
  rightActive: string | null;
  split: boolean;
  activeGroup: GroupIndex;
  sidebarVisible: boolean;
  onSelectTab: (id: string, group: GroupIndex) => void;
  onCloseTab: (id: string) => void;
  onMoveTab: (id: string, group: GroupIndex) => void;
  onReorderTab: (id: string, group: GroupIndex, beforeId: string | null) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  onShowSidebar: () => void;
}

const DRAG_THRESHOLD = 5; // px before a press becomes a drag (vs. a plain click)

export function TabBar(p: Props) {
  // Pointer-based drag, NOT native HTML5 DnD: the tab strip sits on a
  // `-webkit-app-region: drag` titlebar, where Chromium fails to fire reliable
  // dragstart events — so native reordering silently never worked. Pointer
  // events + setPointerCapture bypass app-region entirely.
  const drag = useRef<{ id: string; group: GroupIndex; sx: number; sy: number; moved: boolean } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // where the dragged tab would land in the strip: before/after a target tab
  const [over, setOver] = useState<{ id: string | null; side: 'before' | 'after'; group: GroupIndex } | null>(null);
  const overRef = useRef<{ id: string | null; side: 'before' | 'after'; group: GroupIndex } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const byId = (id: string) => p.tabs.find((t) => t.id === id);

  // Resolve what the cursor is over: a split drop-zone, a tab, or a group strip.
  const hit = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const zone = el?.closest('[data-movegroup]') as HTMLElement | null;
    const groupEl = el?.closest('[data-tab-group]') as HTMLElement | null;
    const tabEl = el?.closest('[data-tab-id]') as HTMLElement | null;
    return {
      moveGroup: zone ? (Number(zone.dataset.movegroup) as GroupIndex) : null,
      group: groupEl ? (Number(groupEl.dataset.tabGroup) as GroupIndex) : null,
      tabId: tabEl?.dataset.tabId ?? null,
      tabEl,
    };
  };

  const onPointerDown = (e: React.PointerEvent, id: string, g: GroupIndex) => {
    if (e.button !== 0) return; // left button only
    p.onSelectTab(id, g);
    drag.current = { id, group: g, sx: e.clientX, sy: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < DRAG_THRESHOLD) return;
      d.moved = true;
      setDragId(d.id);
    }
    const h = hit(e.clientX, e.clientY);
    // split zones appear only once the cursor drops below the tab strip
    const barBottom = barRef.current?.getBoundingClientRect().bottom ?? 0;
    const overPane = e.clientY > barBottom;
    useUi.getState().setTabDrag({ id: d.id, overPane, zone: h.moveGroup });

    if (overPane || h.group === null) {
      overRef.current = null;
      setOver(null);
      return;
    }
    // within the strip → reorder. Insert before/after the hovered tab by which
    // half the cursor is in; over the empty strip → append to that group's end.
    if (h.tabId && h.tabId !== d.id && h.tabEl) {
      const r = h.tabEl.getBoundingClientRect();
      const side: 'before' | 'after' = e.clientX < r.left + r.width / 2 ? 'before' : 'after';
      overRef.current = { id: h.tabId, side, group: h.group };
    } else if (!h.tabId) {
      overRef.current = { id: null, side: 'after', group: h.group };
    } else {
      overRef.current = null; // hovering the dragged tab itself
    }
    setOver(overRef.current);
  };

  const endDrag = (e: React.PointerEvent, commit: boolean) => {
    const d = drag.current;
    drag.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    if (commit && d?.moved) {
      const h = hit(e.clientX, e.clientY);
      const o = overRef.current;
      if (h.moveGroup !== null) {
        // dropped on a split zone (left / right / 화면 분할)
        p.onMoveTab(d.id, h.moveGroup);
      } else if (o) {
        // resolve the insertion point on the de-duped target list (matching the
        // store's reorder, which first removes the dragged tab)
        const list = (o.group === 0 ? p.leftTabs : p.rightTabs).filter((t) => t !== d.id);
        let beforeId: string | null;
        if (o.id === null) beforeId = null; // end of the group
        else {
          const idx = list.indexOf(o.id);
          beforeId = o.side === 'before' ? o.id : (list[idx + 1] ?? null);
        }
        p.onReorderTab(d.id, o.group, beforeId);
      }
    }
    setDragId(null);
    setOver(null);
    overRef.current = null;
    useUi.getState().setTabDrag(null);
  };

  const group = (ids: string[], active: string | null, g: GroupIndex) => (
    <div
      className={`tab-group${p.split && p.activeGroup === g ? ' active' : ''}`}
      data-tab-group={g}
    >
      {ids.map((id, i) => {
        const t = byId(id);
        if (!t) return null;
        // insertion bar: before/after the hovered tab, or after the last tab when
        // dropping on the empty strip of this group
        const ins =
          over && over.group === g
            ? over.id === id
              ? over.side
              : over.id === null && i === ids.length - 1
                ? 'after'
                : null
            : null;
        return (
          <div
            key={id}
            className={`tab${id === active ? ' active' : ''}${id === dragId ? ' dragging' : ''}${
              ins === 'before' ? ' drop-before' : ins === 'after' ? ' drop-after' : ''
            }`}
            title={t.path}
            data-tab-id={id}
            onPointerDown={(e) => onPointerDown(e, id, g)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, true)}
            onPointerCancel={(e) => endDrag(e, false)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, id });
            }}
          >
            <span
              className={`tab-ic tab-ic--${t.kind === 'note' ? 'note' : 'map'}`}
              title={t.kind === 'note' ? '노트' : '마인드맵'}
            >
              <Icon name={t.kind === 'note' ? 'note' : 'mindmap'} />
            </span>
            <span className="tab-title">{t.title || '제목 없음'}</span>
            <TabDirty store={t.store} />
            <button
              className="tab-close"
              title="닫기"
              onPointerDown={(e) => {
                e.stopPropagation();
                p.onCloseTab(id);
              }}
            >
              <Icon name="close" />
            </button>
          </div>
        );
      })}
    </div>
  );

  return (
    <div
      ref={barRef}
      className={`tabbar${p.split ? ' split' : ''}`}
      style={{ paddingLeft: p.sidebarVisible ? 8 : 78 }}
    >
      {!p.sidebarVisible && (
        <button className="tab-tool" title="사이드바 보기" onClick={p.onShowSidebar}>
          <Icon name="menu" />
        </button>
      )}

      {group(p.leftTabs, p.leftActive, 0)}
      {p.split && <div className="tabbar-div" />}
      {p.split && group(p.rightTabs, p.rightActive, 1)}

      {menu && (
        <>
          <div className="ctx-backdrop" onMouseDown={() => setMenu(null)} />
          <div className="ctx-menu tab-menu" style={{ left: menu.x, top: menu.y }}>
            <button
              className="ctx-item"
              onClick={() => {
                p.onCloseTab(menu.id);
                setMenu(null);
              }}
            >
              <span>닫기</span>
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                p.onCloseOthers(menu.id);
                setMenu(null);
              }}
            >
              <span>다른 탭 닫기</span>
            </button>
            <button
              className="ctx-item"
              onClick={() => {
                p.onCloseAll();
                setMenu(null);
              }}
            >
              <span>모두 닫기</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
