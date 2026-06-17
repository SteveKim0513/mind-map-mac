import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { Icon } from './Icon';

/** Immediate in-app feedback for "업데이트 확인" — opens the moment the user asks,
 *  shows a spinner while checking, then a clear result (instead of a slow native
 *  dialog that felt like a hang). Driven by main → renderer status pushes. */
export function UpdateStatus() {
  const s = useUi((st) => st.updateStatus);
  const close = () => useUi.getState().setUpdateStatus(null);

  // Don't let the user dismiss mid-work (checking/downloading); allow otherwise.
  const busy = s?.phase === 'checking' || s?.phase === 'available' || s?.phase === 'downloading';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) close();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [busy]);

  if (!s) return null;

  let icon: React.ReactNode = <span className="updchk-spin" />;
  let title = '';
  let sub: string | null = null;
  let actions: React.ReactNode = null;

  switch (s.phase) {
    case 'checking':
      title = '업데이트 확인 중…';
      sub = '잠시만요, 최신 버전을 확인하고 있어요.';
      break;
    case 'available':
      title = `새 버전 v${s.version} 발견`;
      sub = '내려받는 중…';
      break;
    case 'downloading':
      title = `새 버전 v${s.version} 내려받는 중`;
      sub = `${s.percent}%`;
      icon = (
        <div className="updchk-bar">
          <div className="updchk-bar-fill" style={{ width: `${s.percent}%` }} />
        </div>
      );
      break;
    case 'up-to-date':
      icon = <Icon name="check" />;
      title = '최신 버전입니다';
      sub = `v${s.version}`;
      actions = (
        <button className="updchk-btn primary" onClick={close}>
          확인
        </button>
      );
      break;
    case 'downloaded':
      icon = <Icon name="download" />;
      title = `v${s.version} 준비 완료`;
      sub = '지금 재시동하면 바로 적용됩니다. 작업은 자동 저장되어 있어요.';
      actions = (
        <>
          <button className="updchk-btn" onClick={close}>
            나중에
          </button>
          <button className="updchk-btn primary" onClick={() => void window.api.installUpdate()}>
            지금 재시동
          </button>
        </>
      );
      break;
    case 'error':
      icon = <Icon name="flag" />;
      title = '업데이트를 확인하지 못했어요';
      sub = '네트워크 연결을 확인해 주세요. 앱은 계속 사용할 수 있어요.';
      actions = (
        <>
          <button className="updchk-btn" onClick={close}>
            닫기
          </button>
          <button className="updchk-btn primary" onClick={() => void window.api.checkForUpdates()}>
            다시 시도
          </button>
        </>
      );
      break;
    case 'dev-disabled':
      icon = <Icon name="settings" />;
      title = '개발 빌드예요';
      sub = '이 빌드에서는 자동 업데이트가 꺼져 있습니다.';
      actions = (
        <button className="updchk-btn primary" onClick={close}>
          확인
        </button>
      );
      break;
  }

  return (
    <div className="wh-backdrop" onMouseDown={() => !busy && close()}>
      <div className="updchk" onMouseDown={(e) => e.stopPropagation()}>
        <div className={`updchk-ic phase-${s.phase}`}>{icon}</div>
        <div className="updchk-title">{title}</div>
        {sub && <div className="updchk-sub">{sub}</div>}
        {actions && <div className="updchk-actions">{actions}</div>}
      </div>
    </div>
  );
}
