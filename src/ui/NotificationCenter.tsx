import { useEffect, useState } from 'react';
import { unreadCount, useNotifications } from '../store/notificationStore';
import { useUi } from '../store/uiStore';
import type { NotificationItem } from '../types';
import { fullTime, relTime } from './commentTime';
import { Icon } from './Icon';
import { useOverlayEsc } from './useOverlayEsc';

/**
 * 알림 센터 — 사이드바 맨 아래 종 버튼으로 여는 관리형 오버레이(ADR 0018 스택). 공유 폴더에서 나와 관련된 코멘트 알림을 최신순으로 모은다.
 * 읽음/안 읽음은 굵기·점·"안 읽음" 글자로 구분한다(색에만 기대지 않는다). 패널을 열어도 자동으로 읽음 처리하지 않는다 —
 * 항목을 열거나(자동 읽음), 항목별 토글·"모두 읽음"을 누를 때만 바뀐다. 읽음 상태는 이 기기의 로컬 상태다.
 * 항목을 누르면 `onOpen`(App.tsx가 주입: 스택 해소 → 파일 열기 → 노드/요소 선택·스크롤 → 스레드 열기)이 이동을 맡는다.
 */
export function NotificationCenter({ onOpen }: { onOpen: (item: NotificationItem) => void }) {
  const close = useUi((s) => s.closeNotifications);
  const stackIndex = useUi((s) => s.overlayStack.indexOf('notifications'));
  const items = useNotifications((s) => s.items);
  const unread = unreadCount(items);
  useOverlayEsc('notifications', close);

  // 패널이 열려 있는 동안 "몇 분 전"이 낡지 않게 주기적으로 다시 그린다(읽음 상태는 건드리지 않는다).
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="wh-backdrop" style={{ zIndex: 88 + Math.max(0, stackIndex) }} onMouseDown={close}>
      <div
        className="noti-panel"
        data-testid="notification-center"
        role="dialog"
        aria-label="알림"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="wh-head">
          <Icon name="bell" />
          <span className="wh-title">알림</span>
          <span className="today-summary" data-testid="noti-summary">
            {unread > 0 ? `안 읽음 ${unread}개` : items.length > 0 ? '모두 읽었어요' : ''}
          </span>
          <button
            className="noti-readall"
            data-testid="noti-read-all"
            disabled={unread === 0}
            onClick={() => useNotifications.getState().markAllRead()}
          >
            모두 읽음
          </button>
          <button className="wh-close noti-close" title="닫기 (Esc)" aria-label="닫기" onClick={close}>
            <Icon name="close" />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="today-empty" data-testid="noti-empty">
            새 알림이 없어요.
            <br />
            공유 폴더에서 나와 관련된 코멘트가 달리면 여기에 모여요.
          </div>
        ) : (
          <div className="noti-body">
            {items.map((it) => (
              <NotificationRow key={it.id} item={it} onOpen={onOpen} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const toggle = () => useNotifications.getState().toggleRead(item.id);
  return (
    <div
      className={`noti-row${item.read ? '' : ' unread'}`}
      data-testid="noti-item"
      data-read={item.read ? 'true' : 'false'}
      data-comment-id={item.id}
      role="button"
      tabIndex={0}
      title="눌러서 해당 위치로 이동"
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(item);
        }
      }}
    >
      <span className={`noti-dot${item.read ? ' read' : ''}`} aria-hidden="true" />
      <span className="noti-info">
        <span className="noti-line">
          <span className="noti-author">{item.authorName}</span>
          <span className="noti-where">{item.folderName}</span>
          {!item.read && <span className="noti-tag" data-testid="noti-unread-tag">안 읽음</span>}
        </span>
        <span className="noti-preview">{item.preview}</span>
        <span className="noti-meta">
          {item.targetLabel ? <span className="noti-target">{item.targetLabel}</span> : null}
          <span className="noti-time" title={fullTime(item.createdAt)}>
            {relTime(item.createdAt)}
          </span>
        </span>
      </span>
      <button
        className={`noti-toggle${item.read ? ' on' : ''}`}
        data-testid="noti-toggle"
        aria-pressed={item.read}
        title={item.read ? '안 읽음으로 표시' : '읽음으로 표시'}
        aria-label={item.read ? '안 읽음으로 표시' : '읽음으로 표시'}
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
      >
        <Icon name="check" />
        <span>{item.read ? '읽음' : '읽음 표시'}</span>
      </button>
    </div>
  );
}
