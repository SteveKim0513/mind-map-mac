import { findRoomForPath, useShare } from '../store/shareStore';
import { Icon } from './Icon';

/**
 * 공유로 받은 맵·보드(읽기 전용 뷰어)의 상단 표식 — "소유자만 편집할 수 있어요".
 * 색에만 기대지 않고 아이콘(눈)+텍스트로 상태를 말한다. 소유자·일반 파일에는 그려지지 않는다(호출부가 readOnly일 때만 렌더).
 * 공유가 끝났거나(방이 사라짐) 내보내진 경우에는 안내만 바뀌고 읽기 전용은 유지된다 — 로컬 파일은 지우지 않는다.
 */
export function ViewerBadge({ path }: { path: string | null }) {
  // 방 객체(참조 안정)만 구독한다 — 없으면 공유가 끝난 파일이다.
  const room = useShare((s) => (path ? findRoomForPath(s.rooms, path) : undefined));
  const ended = !room || room.status === 'denied';
  const label = ended ? '보기 전용 · 공유가 끝났어요' : '보기 전용 · 소유자만 편집할 수 있어요';
  const hint = ended
    ? '이 파일은 공유가 끝나 더 이상 업데이트되지 않아요 — 내용은 그대로 볼 수 있어요'
    : '공유 폴더의 파일이에요 — 소유자가 고치면 바로 반영돼요. 편집은 소유자만 할 수 있어요';
  return (
    <div className="viewer-badge" data-testid="viewer-badge" data-state={ended ? 'ended' : 'live'} role="status" title={hint}>
      <Icon name="eye" />
      <span>{label}</span>
    </div>
  );
}
