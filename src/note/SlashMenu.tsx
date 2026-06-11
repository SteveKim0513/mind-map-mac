import { Icon, type IconName } from '../ui/Icon';

export interface SlashItem {
  id: string;
  label: string;
  keys: string; // space-joined search aliases (en) for filtering
  icon?: IconName;
  badge?: string; // e.g. "H1" for headings (no dedicated icon)
  // run on a focused chain; caller appends .run()
  run: (chain: ReturnType<import('@tiptap/react').Editor['chain']>) => unknown;
}

interface Props {
  items: SlashItem[];
  active: number;
  coords: { left: number; top: number };
  onPick: (i: number) => void;
  onHover: (i: number) => void;
}

/** Raycast-style floating block menu shown when the user types "/". */
export function SlashMenu({ items, active, coords, onPick, onHover }: Props) {
  return (
    <div className="slash-menu" style={{ left: coords.left, top: coords.top }}>
      {items.map((it, i) => (
        <button
          key={it.id}
          className={`slash-item${i === active ? ' active' : ''}`}
          onMouseMove={() => onHover(i)}
          onMouseDown={(e) => {
            e.preventDefault(); // keep editor focus
            onPick(i);
          }}
        >
          <span className="slash-ic">
            {it.badge ? <span className="slash-badge">{it.badge}</span> : it.icon && <Icon name={it.icon} />}
          </span>
          <span className="slash-label">{it.label}</span>
        </button>
      ))}
    </div>
  );
}
