import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { recordCommandUsage, sortByUsage, quickKeyAssignments } from './commandUsage';

export interface Command {
  id: string;
  label: string;
  hint?: string;
  icon?: IconName;
  run: () => void;
}

interface Item extends Command {
  group: '명령' | '노드' | '파일';
}

export interface NodeHit {
  id: string;
  text: string;
  run: () => void;
}

export function CommandPalette({
  commands,
  files,
  nodes,
  onSearchEverywhere,
  onClose,
}: {
  commands: Command[];
  files: { path: string; name: string; folder: string; run: () => void }[];
  /** 현재 열린 맵의 노드 — 있을 때만 "노드" 그룹으로 함께 검색된다 (IA-STRATEGY §5-1). */
  nodes?: NodeHit[];
  /** "전체에서 찾기" 힌트 클릭 시 호출 — 팔레트를 닫고 전체 검색(⌘⇧F)을 연다. */
  onSearchEverywhere?: (query: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Frequently-run commands rise to the top of the empty-query list and earn an
  // ⌥1-9 quick key (Spotlight "Quick Keys" pattern, REDESIGN-VISION §3-7).
  const rankedCommandIds = useMemo(() => sortByUsage(commands).map((c) => c.id), [commands]);
  const quickKeys = useMemo(() => quickKeyAssignments(rankedCommandIds), [rankedCommandIds]);

  const items = useMemo<Item[]>(() => {
    const byId = new Map(commands.map((c) => [c.id, c]));
    const cmds: Item[] = rankedCommandIds
      .map((id) => byId.get(id))
      .filter((c): c is Command => !!c)
      .map((c) => ({ ...c, group: '명령' }));
    const fileItems: Item[] = files.map((f) => ({
      id: `file:${f.path}`,
      label: f.name,
      hint: f.folder,
      icon: 'file' as const,
      run: f.run,
      group: '파일' as const,
    }));
    const s = q.trim().toLowerCase();
    // Empty query: show only commands (files are reachable via ⌘P)
    if (!s) return cmds.slice(0, 60);
    const nodeItems: Item[] = (nodes ?? []).map((n) => ({
      id: `node:${n.id}`,
      label: n.text || '제목 없음',
      icon: 'mindmap' as const,
      run: n.run,
      group: '노드' as const,
    }));
    return [...cmds, ...nodeItems, ...fileItems]
      .filter((i) => `${i.label} ${i.hint ?? ''}`.toLowerCase().includes(s))
      .slice(0, 60);
  }, [q, commands, rankedCommandIds, files, nodes]);

  useEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIdx(0), [q]);

  const choose = (i: number) => {
    const it = items[i];
    if (it) {
      if (it.group === '명령') recordCommandUsage(it.id);
      it.run();
      onClose();
    }
  };

  // ⌥1-9 runs a learned command instantly, independent of the current query/selection.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.metaKey || e.ctrlKey) return;
      const n = parseInt(e.key, 10);
      if (!(n >= 1 && n <= 9)) return;
      const id = [...quickKeys.entries()].find(([, slot]) => slot === n)?.[0];
      if (!id) return;
      const cmd = commands.find((c) => c.id === id);
      if (!cmd) return;
      e.preventDefault();
      recordCommandUsage(cmd.id);
      cmd.run();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [quickKeys, commands, onClose]);

  let lastGroup = '';

  return (
    <div className="qo-backdrop" onMouseDown={onClose}>
      <div className="qo" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          placeholder={nodes?.length ? '명령 실행 · 노드 검색… (파일 열기는 ⌘P)' : '명령 실행… (파일 열기는 ⌘P)'}
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
                      {it.icon && (
                        <span className="qo-ic">
                          <Icon name={it.icon} />
                        </span>
                      )}
                      <span className="qo-name-txt">{it.label}</span>
                    </span>
                    {it.group === '명령' && quickKeys.has(it.id) && (
                      <kbd className="qo-quickkey" title="⌥ + 숫자로 바로 실행">⌥{quickKeys.get(it.id)}</kbd>
                    )}
                    {it.hint && <span className="qo-folder">{it.hint}</span>}
                  </button>
                </div>
              );
            })
          )}
        </div>
        {q.trim() && onSearchEverywhere && (
          <button
            className="qo-more"
            onClick={() => {
              onSearchEverywhere(q);
              onClose();
            }}
          >
            <Icon name="search" />
            전체에서 찾기 (노트·다른 맵 포함)
            <kbd>⌘⇧F</kbd>
          </button>
        )}
      </div>
    </div>
  );
}
