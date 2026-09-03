import { useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { MapStore } from '../store/mapStore';
import type { BoardStore } from '../store/boardStore';
import type { Tab } from '../store/sessionStore';
import { TAG_KEYS, TAG_DEFAULT_LABELS, tagVar, type TagKey } from '../theme/palette';
import { Icon } from '../ui/Icon';
import { useOutsideDismiss } from '../ui/useOutsideDismiss';

const TAG_KEY_SET = new Set<string>(TAG_KEYS);

/** A single chip: dot + label, click toggles the color filter. Hover reveals a
 *  pencil that switches the label into an inline edit (Enter/blur save, Esc cancel).
 *  Prop-driven (not store-typed) so both the map and board tag bars share it. */
function TagChip({
  tagKey,
  label,
  active,
  onToggle,
  onRename,
}: {
  tagKey: TagKey;
  label: string;
  active: boolean;
  onToggle: () => void;
  onRename: (label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const cancelledRef = useRef(false);

  if (editing) {
    return (
      <span className="tagbar-chip on-edit">
        <span className="tagbar-chip-dot" style={{ background: tagVar(tagKey) }} />
        <input
          className="tagbar-edit-input"
          defaultValue={label}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            else if (e.key === 'Escape') {
              cancelledRef.current = true;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            if (!cancelledRef.current) onRename(e.currentTarget.value.trim());
            cancelledRef.current = false;
            setEditing(false);
          }}
        />
      </span>
    );
  }

  return (
    <span className={`tagbar-chip${active ? ' on' : ''}`}>
      <button
        className="tagbar-chip-main"
        title={active ? '필터 해제' : `이 색만 보기 — ${label}`}
        onClick={onToggle}
      >
        <span className="tagbar-chip-dot" style={{ background: tagVar(tagKey) }} />
        <span className="tagbar-chip-label">{label}</span>
      </button>
      <button className="tagbar-chip-edit" title="라벨 수정" onClick={() => setEditing(true)}>
        <Icon name="edit" />
      </button>
    </span>
  );
}

/** "＋" — define a label for a tag key that has none yet. A small popover lists the
 *  remaining keys; picking one turns into an inline text input (Enter confirms). */
function AddTagButton({ remaining, onPick }: { remaining: TagKey[]; onPick: (key: TagKey, label: string) => void }) {
  const [open, setOpen] = useState(false);
  const [pickedKey, setPickedKey] = useState<TagKey | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setPickedKey(null);
  };
  useOutsideDismiss(ref, close);

  return (
    <div className="tagbar-add-wrap" ref={ref}>
      <button className="tagbar-add" title="태그 라벨 추가" onClick={() => setOpen((v) => !v)}>
        <Icon name="plus" />
      </button>
      {open && (
        <div className="tagbar-add-pop">
          {pickedKey ? (
            <div className="tagbar-add-row">
              <span className="tagbar-chip-dot" style={{ background: tagVar(pickedKey) }} />
              <input
                className="tagbar-edit-input"
                placeholder={TAG_DEFAULT_LABELS[pickedKey]}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const text = e.currentTarget.value.trim();
                    if (text) onPick(pickedKey, text);
                    close();
                  } else if (e.key === 'Escape') {
                    close();
                  }
                }}
              />
            </div>
          ) : (
            remaining.map((key) => (
              <button key={key} className="tagbar-add-option" onClick={() => setPickedKey(key)}>
                <span className="tagbar-chip-dot" style={{ background: tagVar(key) }} />
                <span>{TAG_DEFAULT_LABELS[key]}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function MapTagBarSide({ store }: { store: MapStore }) {
  const doc = useStore(store, (s) => s.doc);
  const colorFilter = useStore(store, (s) => s.colorFilter);
  const filterAncestors = useStore(store, (s) => s.filterAncestors);
  const filterDescendants = useStore(store, (s) => s.filterDescendants);

  const chips = useMemo(() => {
    const used = new Set<string>();
    for (const n of Object.values(doc.nodes)) if (n.color && TAG_KEY_SET.has(n.color)) used.add(n.color);
    for (const k of Object.keys(doc.tagLabels ?? {})) used.add(k);
    return TAG_KEYS.filter((k) => used.has(k));
  }, [doc]);

  const remaining = useMemo(() => TAG_KEYS.filter((k) => !chips.includes(k)), [chips]);

  const activeShown = colorFilter && (chips as string[]).includes(colorFilter);

  return (
    <div className="tagbar-side">
      {/* Chips overflow-clip on their own — kept out of the "+" button's subtree so its
          dropdown (absolutely positioned) isn't clipped by this row's overflow:hidden. */}
      <div className="tagbar-chips">
        {chips.map((key) => (
          <TagChip
            key={key}
            tagKey={key}
            label={doc.tagLabels?.[key] ?? TAG_DEFAULT_LABELS[key]}
            active={colorFilter === key}
            onToggle={() => store.getState().setColorFilter(colorFilter === key ? null : key)}
            onRename={(label) => store.getState().setTagLabel(key, label)}
          />
        ))}
        {activeShown && (
          <>
            <button
              className={`tool-btn small${filterAncestors ? ' on' : ''}`}
              title="상위 노드 포함"
              onClick={() => store.getState().toggleFilterAncestors()}
            >
              <Icon name="chevronUp" />
              상위
            </button>
            <button
              className={`tool-btn small${filterDescendants ? ' on' : ''}`}
              title="하위 노드 포함"
              onClick={() => store.getState().toggleFilterDescendants()}
            >
              <Icon name="chevronDown" />
              하위
            </button>
          </>
        )}
      </div>
      {remaining.length > 0 && (
        <AddTagButton remaining={remaining} onPick={(key, label) => store.getState().setTagLabel(key, label)} />
      )}
    </div>
  );
}

function BoardTagBarSide({ store }: { store: BoardStore }) {
  const board = useStore(store, (s) => s.board);
  const colorFilter = useStore(store, (s) => s.colorFilter);

  const chips = useMemo(() => {
    const used = new Set<string>();
    for (const el of Object.values(board.elements)) {
      if (el.kind === 'sticky' && el.color && TAG_KEY_SET.has(el.color)) used.add(el.color);
    }
    for (const k of Object.keys(board.tagLabels ?? {})) used.add(k);
    return TAG_KEYS.filter((k) => used.has(k));
  }, [board]);

  const remaining = useMemo(() => TAG_KEYS.filter((k) => !chips.includes(k)), [chips]);

  return (
    <div className="tagbar-side">
      <div className="tagbar-chips">
        {chips.map((key) => (
          <TagChip
            key={key}
            tagKey={key}
            label={board.tagLabels?.[key] ?? TAG_DEFAULT_LABELS[key]}
            active={colorFilter === key}
            onToggle={() => store.getState().setColorFilter(colorFilter === key ? null : key)}
            onRename={(label) => store.getState().setTagLabel(key, label)}
          />
        ))}
      </div>
      {remaining.length > 0 && (
        <AddTagButton remaining={remaining} onPick={(key, label) => store.getState().setTagLabel(key, label)} />
      )}
    </div>
  );
}

function TagBarSide({ tab }: { tab: Tab | null }) {
  if (tab?.kind === 'map' && tab.store) return <MapTagBarSide store={tab.store as MapStore} />;
  if (tab?.kind === 'board' && tab.store) return <BoardTagBarSide store={tab.store as BoardStore} />;
  return <div className="tagbar-side" />;
}

interface Props {
  leftTab: Tab | null;
  rightTab: Tab | null;
  split: boolean;
}

/** Sibling of PathBar, same 22px row, directly beneath it — the per-document color
 *  tag legend (색상 태그 범례), shared by maps and boards. Unlike PathBar it does NOT
 *  reserve its row when neither open tab is a map/board: renders nothing at all
 *  (no empty 22px strip). */
export function TagBar({ leftTab, rightTab, split }: Props) {
  const isTaggable = (t: Tab | null) => t?.kind === 'map' || t?.kind === 'board';
  const showRow = isTaggable(leftTab) || (split && isTaggable(rightTab));
  if (!showRow) return null;
  return (
    <div className={`tagbar${split ? ' split' : ''}`}>
      <TagBarSide key={leftTab?.path ?? 'left-empty'} tab={leftTab} />
      {split && <div className="tagbar-div" />}
      {split && <TagBarSide key={rightTab?.path ?? 'right-empty'} tab={rightTab} />}
    </div>
  );
}
