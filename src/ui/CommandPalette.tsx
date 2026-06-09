import { useEffect, useMemo, useRef, useState } from 'react';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: string;
  run: () => void;
}

interface Item extends Command {
  group: '명령' | '파일';
}

export function CommandPalette({
  commands,
  files,
  onClose,
}: {
  commands: Command[];
  files: { path: string; name: string; folder: string; run: () => void }[];
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo<Item[]>(() => {
    const cmds: Item[] = commands.map((c) => ({ ...c, group: '명령' }));
    const fileItems: Item[] = files.map((f) => ({
      id: `file:${f.path}`,
      label: f.name,
      hint: f.folder,
      icon: '🗒',
      run: f.run,
      group: '파일',
    }));
    const all = [...cmds, ...fileItems];
    const s = q.trim().toLowerCase();
    if (!s) return all.slice(0, 60);
    return all
      .filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(s))
      .slice(0, 60);
  }, [q, commands, files]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIdx(0), [q]);

  const choose = (i: number) => {
    const it = items[i];
    if (it) {
      it.run();
      onClose();
    }
  };

  let lastGroup = '';

  return (
    <div className="qo-backdrop" onMouseDown={onClose}>
      <div className="qo" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          placeholder="명령 실행 또는 파일 열기…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              choose(idx);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
        />
        <div className="qo-list">
          {items.length === 0 ? (
            <div className="qo-empty">일치하는 항목이 없습니다</div>
          ) : (
            items.map((it, i) => {
              const header = it.group !== lastGroup ? ((lastGroup = it.group), it.group) : null;
              return (
                <div key={it.id}>
                  {header && <div className="qo-group">{header}</div>}
                  <button
                    className={`qo-item${i === idx ? ' active' : ''}`}
                    onMouseEnter={() => setIdx(i)}
                    onClick={() => choose(i)}
                  >
                    <span className="qo-name">
                      {it.icon ? `${it.icon} ` : ''}
                      {it.label}
                    </span>
                    {it.hint && <span className="qo-folder">{it.hint}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
