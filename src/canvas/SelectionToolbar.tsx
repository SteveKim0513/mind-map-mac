import { useState } from 'react';
import { useMap, useMapStore } from '../store/mapStore';
import { useUi } from '../store/uiStore';
import { requestFocusStart } from '../focus/controller';
import { Icon } from '../ui/Icon';
import { tagVar } from '../theme/palette';
import { ColorSwatchGrid } from '../ui/ColorSwatchGrid';

/** Floating action bar shown above the single selected node. Button order
 * follows the 3-axis model (결정 0011): 정리(색·메모) → 실행(완료·집중) →
 * 구조(자식추가·삭제).
 *
 * 일정·링크·노드에 노트 연결은 여기 없다 — 이 셋은 값이 있을 때만 보이는
 * 게이지 칩(`NodeView.tsx`)과 항상 존재하는 우클릭 메뉴(`ContextMenu.tsx`)
 * 두 곳으로만 접근한다. 예전엔 이 툴바에도 아이콘이 있어 같은 기능이
 * 칩·아이콘·메뉴 텍스트 세 가지 다른 모습으로 흩어져 있었다
 * (UX-CLARITY-VISION 전략 C, REDESIGN-VISION §T2가 애초에 "자주 쓰는
 * 3~4개만" 남기라고 정했던 것과도 맞춘다).
 *
 * 집중 버튼은 `node.scheduled`일 때만 나타난다 — 집중 세션은 일정이 지정된
 * 노드를 실행하는 걸 돕는 모드라는 재정의(결정 0011 §3)를 그대로 게이트로
 * 건다. 일정 없는 노드를 선택하면 이 버튼 자체가 없다. */
export function SelectionToolbar({ nodeId, sx, sy }: { nodeId: string; sx: number; sy: number }) {
  const node = useMap((s) => s.doc.nodes[nodeId]);
  const setColor = useMap((s) => s.setColor);
  const toggleDone = useMap((s) => s.toggleDone);
  const addChild = useMap((s) => s.addChild);
  const deleteNode = useMap((s) => s.deleteNode);
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
      {/* 정리 */}
      <button
        className="st-btn"
        title="색상"
        onClick={() => setShowColors((v) => !v)}
      >
        <span className="st-dot" style={{ background: tagVar(node.color) ?? 'var(--ink-faint)' }} />
      </button>
      <button className="st-btn" title="메모" onClick={() => useUi.getState().setMemoEditFor(nodeId)}>
        <Icon name="memo" />
      </button>
      <span className="st-sep" />

      {/* 실행 */}
      <button
        className={`st-btn${node.done ? ' on' : ''}`}
        title="완료"
        onClick={() => toggleDone(nodeId)}
      >
        <Icon name="check" />
      </button>
      {node.scheduled && (
        <button
          className={`st-btn${focusing ? ' on' : ''}`}
          title={focusing ? '집중 중 (클릭하면 안내)' : '집중 시작'}
          onClick={() => {
            if (focusing) useUi.getState().toast('집중이 이미 진행 중입니다. 먼저 종료하세요.');
            else requestFocusStart(mapStore, nodeId);
          }}
        >
          <Icon name="clock" />
        </button>
      )}
      <span className="st-sep" />

      {/* 구조 */}
      <button className="st-btn" title="자식 추가" onClick={() => addChild(nodeId)}>
        <Icon name="plus" />
      </button>
      <button className="st-btn danger" title="삭제" onClick={() => deleteNode(nodeId)}>
        <Icon name="trash" />
      </button>

      {showColors && (
        <div className="st-swatches">
          <ColorSwatchGrid
            value={node.color}
            onChange={(c) => {
              setColor(nodeId, c);
              setShowColors(false);
            }}
          />
        </div>
      )}
    </div>
  );
}
