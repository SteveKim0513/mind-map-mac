import { useState } from 'react';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { requestFocusStart } from '../focus/controller';
import { Icon } from '../ui/Icon';
import { TAG_KEYS, tagVar } from '../theme/palette';

/** Floating action bar shown above the single selected node. */
export function SelectionToolbar({ nodeId, sx, sy }: { nodeId: string; sx: number; sy: number }) {
  const node = useMap((s) => s.doc.nodes[nodeId]);
  const setColor = useMap((s) => s.setColor);
  const toggleDone = useMap((s) => s.toggleDone);
  const addChild = useMap((s) => s.addChild);
  const deleteNode = useMap((s) => s.deleteNode);
  const setScheduled = useMap((s) => s.setScheduled);
  const docId = useMap((s) => s.doc.id);
  const filePath = useMap((s) => s.filePath);
  const mapStore = useMapStore();
  const focusing = useUi((s) => !!s.activeFocus);
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
        <span className="st-dot" style={{ background: tagVar(node.color) ?? 'var(--ink-faint)' }} />
      </button>
      <button
        className={`st-btn${node.done ? ' on' : ''}`}
        title="완료"
        onClick={() => toggleDone(nodeId)}
      >
        <Icon name="check" />
      </button>
      <span className="st-sep" />
      <button className="st-btn" title="메모" onClick={() => useUi.getState().setMemoEditFor(nodeId)}>
        <Icon name="memo" />
      </button>
      <button className="st-btn" title="링크" onClick={() => useUi.getState().openAddLink(nodeId)}>
        <Icon name="link" />
      </button>
      <button
        className="st-btn"
        title="노드에 노트 연결"
        onClick={() =>
          useUi.getState().openLinkNote({
            mapId: docId ?? '',
            nodeId,
            nodeText: node.text,
            mapPath: filePath ?? '',
          })
        }
      >
        <Icon name="note" />
      </button>
      <button
        className={`st-btn${node.scheduled ? ' on' : ''}`}
        title="일정"
        onClick={() => {
          if (!node.scheduled) setScheduled(nodeId, true);
          useUi.getState().openSchedule(nodeId);
        }}
      >
        <Icon name="calendar" />
      </button>
      <button
        className={`st-btn${focusing ? ' on' : ''}`}
        title={focusing ? '집중 세션 진행 중 (클릭하면 안내)' : '집중 세션 시작'}
        onClick={() => {
          if (focusing) useUi.getState().toast('집중 세션이 이미 진행 중입니다. 세션을 먼저 종료하세요.');
          else requestFocusStart(mapStore, nodeId);
        }}
      >
        <Icon name="clock" />
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
          {TAG_KEYS.map((c) => (
            <button
              key={c}
              className="st-swatch"
              style={{ background: tagVar(c) }}
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
