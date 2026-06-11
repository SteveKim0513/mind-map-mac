import { useEffect, useRef, useState } from 'react';

interface Props {
  busy: boolean;
  error: string | null;
  onSubmit: (url: string) => void;
  onClose: () => void;
}

/** Small modal: paste a URL → "URL → note" import. Prefills from the clipboard. */
export function UrlImportModal({ busy, error, onSubmit, onClose }: Props) {
  const [url, setUrl] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // open empty + focused so the user just pastes (Cmd+V) — no stale prefill
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, busy]);

  const submit = () => {
    const u = url.trim();
    if (u && !busy) onSubmit(u);
  };

  return (
    <div className="qo-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="qo url-import" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          placeholder="https://… 링크를 붙여넣으세요"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          disabled={busy}
        />
        <div className="url-import-foot">
          <span className="url-import-msg">
            {busy ? '본문을 가져오는 중…' : error ? error : '제목과 본문을 가져와 노트로 만듭니다'}
          </span>
          <div className="url-import-btns">
            <button className="btn" onClick={onClose} disabled={busy}>
              취소
            </button>
            <button className="btn primary" onClick={submit} disabled={busy || !url.trim()}>
              {busy ? '가져오는 중…' : '노트 만들기'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
