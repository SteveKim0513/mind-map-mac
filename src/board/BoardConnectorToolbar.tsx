import { useState } from 'react';
import { tagVar } from '../theme/palette';
import { ColorSwatchGrid } from '../ui/ColorSwatchGrid';

interface Props {
  color: string | undefined; // first selected connector's color — representative default for a multi-select
  sx: number;
  sy: number;
  onChange: (color: string | undefined) => void;
}

/** Floating color-only toolbar for a selected connector (or connectors) —
 *  same screen-space positioning + `sel-toolbar`/`st-btn`/`st-swatches` CSS as
 *  BoardSelectionToolbar.tsx's sticky/image toolbar, but connectors have no
 *  other editable fields (shape/align/format/연동 don't apply to an arrow),
 *  so this is its own minimal component rather than folding a third element
 *  kind into BoardSelectionToolbar's `LinkableElement` union. 2026-09-07 —
 *  connectors already had a `color` field and the line already rendered it
 *  (`tagVar(el.color)`), but there was no UI anywhere to actually set it. */
export function BoardConnectorToolbar({ color, sx, sy, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className="sel-toolbar"
      style={{ left: sx, top: sy }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button className="st-btn" title="화살표 색" onClick={() => setOpen((v) => !v)}>
        <span className="st-dot" style={{ background: color ? tagVar(color) : 'var(--ink-muted)' }} />
      </button>
      {open && (
        <div className="st-swatches">
          <ColorSwatchGrid value={color} onChange={(c) => { onChange(c); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}
