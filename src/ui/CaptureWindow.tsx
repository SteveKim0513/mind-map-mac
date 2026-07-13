import { useEffect, useRef, useState } from 'react';
import { emptyDoc, serialize, deserialize, newId } from '../io/formats';
import { parseScheduleText, parseHashtagColor } from '../store/parseNodeText';
import { Icon } from './Icon';

/**
 * The renderer for the global quick-capture window (electron/main.ts,
 * REDESIGN-VISION §3-1). A separate always-on-top BrowserWindow loads this
 * same bundle with ?capture=1 — kept as a renderer view (not main-process
 * logic) so it can reuse src/io/formats.ts as the single source of truth for
 * the .mind schema, instead of duplicating that knowledge in electron/main.ts.
 */
export function CaptureWindow() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setText('');
    setBusy(false);
    inputRef.current?.focus();
  };

  useEffect(() => {
    reset();
    return window.api.capture.onShown(reset);
  }, []);

  const hide = () => void window.api.capture.hide();

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const targetPath = await window.api.capture.targetPath();
      let doc;
      try {
        doc = deserialize(await window.api.readFile(targetPath));
      } catch {
        doc = emptyDoc();
      }
      const id = newId();
      const sched = parseScheduleText(trimmed);
      const color = parseHashtagColor(trimmed);
      doc.nodes[id] = {
        id,
        text: trimmed,
        parentId: null,
        children: [],
        collapsed: false,
        ...(sched.matched && sched.scheduleAt ? { scheduled: true, scheduleAt: sched.scheduleAt } : {}),
        ...(color ? { color } : {}),
      };
      doc.rootIds.push(id);
      await window.api.save(targetPath, serialize(doc));
      await window.api.capture.notifyAppended(targetPath);
      hide();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="capture-window">
      <Icon name="bulb" />
      <input
        ref={inputRef}
        className="capture-input"
        placeholder="빠르게 떠오른 생각을 적으세요…"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void submit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            hide();
          }
        }}
      />
      <span className="capture-hint">Enter 저장 · Esc 닫기</span>
    </div>
  );
}
