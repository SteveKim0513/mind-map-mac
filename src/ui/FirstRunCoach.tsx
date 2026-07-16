/**
 * 첫 실행 코치 — 처음 빈 워크스페이스에서 캔버스 위에 뜨는 조용한 안내
 * (카피 감사 §4-3, UX-CLARITY 전략 E). 모달 설명서가 아니라 실제로 눌러야 할
 * 첫 동작들을 그 자리에서 보여준다. 언제든 건너뛸 수 있고, 첫 노드를 만들거나
 * 건너뛰면 다시 뜨지 않는다(호출 측 localStorage 'onboardingSeen').
 *
 * 세 걸음은 정리→실행의 자연스러운 흐름이다: 적고(Enter) → 잇고(Tab) →
 * "@내일 3시"로 일정까지 그 자리에서(실행으로 넘어가는 빠른 길).
 */
export function FirstRunCoach({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="frc" role="dialog" aria-label="시작 안내">
      <div className="frc-title">여기서 시작하세요</div>
      <ol className="frc-steps">
        <li>
          <kbd>Enter</kbd>
          <span>첫 생각을 적어요</span>
        </li>
        <li>
          <kbd>Tab</kbd>
          <span>아래로 생각을 이어가요</span>
        </li>
        <li>
          <span className="frc-type">@내일 3시</span>
          <span>이렇게 적으면 일정이 잡혀요</span>
        </li>
      </ol>
      <button className="frc-skip" onClick={onDismiss}>
        건너뛰기
      </button>
    </div>
  );
}
