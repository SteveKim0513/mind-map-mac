import { useState } from 'react';
import { useMap } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { Icon } from '../ui/Icon';

const COLORS = ['#62aef0', '#d6b6f6', '#ff64c8', '#dd5b00', '#2a9d99', '#1aae39'];

/** Floating action bar shown above the single selected node. */
export function SelectionToolbar({ nodeId, sx, sy }: { nodeId: string; sx: number; sy: number }) {
  const node = useMap((s) => s.doc.nodes[nodeId]);
  const setColor = useMap((s) => s.setColor);
  const toggleDone = useMap((s) => s.toggleDone);
  const addChild = useMap((s) => s.addChild);
  const deleteNode = useMap((s) => s.deleteNode);
  const setScheduled = useMap((s) => s.setScheduled);
  const [showColors, setShowColors] = useState(false);

  if (!node) return null;

  return (
    <div
      className="sel-toolbar"
      style={{ left: sx, top: sy }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <button
        className="st-btn"
        title="색상"
        onClick={() => setShowColors((v) => !v)}
      >
        <span className="st-dot" style={{ background: node.color ?? 'var(--ink-faint)' }} />
      </button>
      <button
        className={`st-btn${node.done ? ' on' : ''}`}
        title="완료"
        onClick={() => toggleDone(nodeId)}
      >
        <Icon name="check" />
      </button>
      <button className="st-btn" title="노트·링크" onClick={() => useUi.getState().openNote(nodeId)}>
        <Icon name="note" />
      </button>
      <button
        className={`st-btn${node.scheduled ? ' on' : ''}`}
        title="스케줄"
        onClick={() => {
          if (!node.scheduled) setScheduled(nodeId, true);
          useUi.getState().openSchedule(nodeId);
        }}
      >
        <Icon name="calendar" />
      </button>
      <span className="st-sep" />
      <button className="st-btn" title="자식 추가" onClick={() => addChild(nodeId)}>
        <Icon name="plus" />
      </button>
      <button className="st-btn danger" title="삭제" onClick={() => deleteNode(nodeId)}>
        <Icon name="trash" />
      </button>

      {showColors && (
        <div className="st-swatches">
          {COLORS.map((c) => (
            <button
              key={c}
              className="st-swatch"
              style={{ background: c }}
              onClick={() => {
                setColor(nodeId, node.color === c ? undefined : c);
                setShowColors(false);
              }}
            />
          ))}
          <button
            className="st-swatch none"
            title="색 제거"
            onClick={() => {
              setColor(nodeId, undefined);
              setShowColors(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
