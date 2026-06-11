import { useState } from 'react';
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

export function TabBar(p: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<GroupIndex | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const byId = (id: string) => p.tabs.find((t) => t.id === id);

  const group = (ids: string[], active: string | null, g: GroupIndex) => (
    <div
      className={`tab-group${p.split && p.activeGroup === g ? ' active' : ''}${
        dropGroup === g ? ' drop' : ''
      }`}
      onDragOver={(e) => {
        if (!dragId) return;
        e.preventDefault();
        if (dropGroup !== g) setDropGroup(g);
      }}
      onDragLeave={() => setDropGroup((d) => (d === g ? null : d))}
      onDrop={(e) => {
        e.preventDefault();
        const id = e.dataTransfer.getData('text/plain') || dragId;
        if (id) p.onMoveTab(id, g);
        setDropGroup(null);
        setDragId(null);
      }}
    >
      {ids.map((id) => {
        const t = byId(id);
        if (!t) return null;
        return (
          <div
            key={id}
            className={`tab${id === active ? ' active' : ''}`}
            title={t.path}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData('text/plain', id);
              e.dataTransfer.effectAllowed = 'move';
              setDragId(id);
              useUi.getState().setTabDrag(id);
            }}
            onDragEnd={() => {
              setDragId(null);
              setDropGroup(null);
              useUi.getState().setTabDrag(null);
            }}
            onDragOver={(e) => {
              if (dragId && dragId !== id) e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const src = e.dataTransfer.getData('text/plain') || dragId;
              if (src && src !== id) p.onReorderTab(src, g, id);
              setDropGroup(null);
              setDragId(null);
            }}
            onPointerDown={() => p.onSelectTab(id, g)}
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
