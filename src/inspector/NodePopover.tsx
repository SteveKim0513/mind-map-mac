import { useEffect, useRef } from 'react';
import { useMap } from '../store/mapStore';
import { Icon, type IconName } from '../ui/Icon';
import { useNodeAnchoredPosition } from '../ui/useNodeAnchoredPosition';
import { useOutsideDismiss } from '../ui/useOutsideDismiss';

const ICONS: { name: IconName; label: string }[] = [
  { name: 'star', label: '별표' },
  { name: 'check', label: '완료' },
  { name: 'flag', label: '깃발' },
  { name: 'bulb', label: '아이디어' },
  { name: 'pin', label: '핀' },
  { name: 'target', label: '목표' },
];

// migrate emoji icons saved by the old picker to the new line-icon names
const LEGACY_ICONS: Record<string, IconName> = {
  '⭐': 'star',
  '✅': 'check',
  '❗': 'flag',
  '💡': 'bulb',
  '📌': 'pin',
  '🎯': 'target',
};

interface Props {
  id: string;
  onClose: () => void;
}

/** Icon picker floated beside its node. (Memo · link · note now have their own
 *  dedicated paths — this popover is icon-only.) */
export function NodePopover({ id, onClose }: Props) {
  const node = useMap((s) => s.doc.nodes[id]);
  const setIcon = useMap((s) => s.setIcon);

  const ref = useRef<HTMLDivElement>(null);
  const pos = useNodeAnchoredPosition(id, 220);
  useOutsideDismiss(ref, onClose);

  // one-time upgrade: a node saved with the old emoji picker → its line-icon name
  const legacyIcon = node?.icon ? LEGACY_ICONS[node.icon] : undefined;
  useEffect(() => {
    if (legacyIcon) setIcon(id, legacyIcon);
  }, [id, legacyIcon, setIcon]);

  if (!node || !pos) return null;

  return (
    <div
      ref={ref}
      className="note-pop icon-pop"
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="note-pop-head">
        <span className="note-pop-title">아이콘</span>
        <button className="note-pop-x" title="닫기 (Esc)" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>

      <div className="note-pop-icons">
        {ICONS.map(({ name, label }) => (
          <button
            key={name}
            className={`icon-opt${node.icon === name ? ' on' : ''}`}
            title={label}
            onClick={() => setIcon(id, node.icon === name ? undefined : name)}
          >
            <Icon name={name} />
          </button>
        ))}
        {node.icon && (
          <button className="icon-opt clear" title="아이콘 제거" onClick={() => setIcon(id, undefined)}>
            <Icon name="close" />
          </button>
        )}
      </div>
    </div>
  );
}
