import { connStatusText } from '../share';
import type { ShareConnStatus } from '../types';
import { Icon } from './Icon';

/** 화면에 쓰는 상태 키 — 저장소의 5개 상태를 사용자가 구분할 4가지로 묶는다(idle·disconnected = 오프라인). */
export type ShareStatusKey = 'connected' | 'connecting' | 'offline' | 'denied';

export function shareStatusKey(status: ShareConnStatus): ShareStatusKey {
  if (status === 'connected') return 'connected';
  if (status === 'connecting') return 'connecting';
  if (status === 'denied') return 'denied';
  return 'offline';
}

/**
 * 공유 폴더 표시: 사람 아이콘 + 상태 점. 사이드바 행과 공유 설정 패널이 같은 모양을 쓴다.
 * 상태는 색만으로 전달하지 않는다 — 아이콘 모양(접근 해제 = 사선)과 점 모양(연결됨 = 채움,
 * 오프라인·연결 중 = 빈 고리)이 함께 다르고, 접근성 라벨에 상태 이름이 들어간다.
 * 새 hue는 쓰지 않는다: 연결됨 = 기존 "활성 초록"(--state-done), 나머지는 중립 잉크.
 */
export function ShareStatusIcon({ status, error = null }: { status: ShareConnStatus; error?: string | null }) {
  const key = shareStatusKey(status);
  return (
    <span className={`share-ic share-ic--${key}`} data-share-status={key} role="img" aria-label={connStatusText(status, error)}>
      <Icon name={key === 'denied' ? 'userOff' : 'users'} />
      <span className="share-dot" aria-hidden="true" />
    </span>
  );
}
