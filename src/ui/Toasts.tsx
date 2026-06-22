import { useUi } from '../store/uiStore';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.action ? ' toast--action' : ''}`}>
          <span className="toast-msg">{t.msg}</span>
          {t.action && (
            <button className="toast-action" onClick={t.action.onClick}>
              {t.action.label}
            </button>
          )}
          <button className="toast-dismiss" title="닫기" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
