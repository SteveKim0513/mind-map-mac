import { useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspace } from '../store/workspaceStore';
import { Icon } from './Icon';
import type { TreeNode } from '../../electron/preload';

function flatten(nodes: TreeNode[], folder: string, out: { path: string; name: string; folder: string }[]) {
  for (const n of nodes) {
    if (n.type === 'file') {
      out.push({ path: n.path, name: n.name.replace(/\.(mind|md)$/, ''), folder });
    } else if (n.children) {
      flatten(n.children, folder ? `${folder} / ${n.name}` : n.name, out);
    }
  }
}

export function QuickOpen({ onOpen, onClose }: { onOpen: (path: string) => void; onClose: () => void }) {
  const tree = useWorkspace((s) => s.tree);
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const all = useMemo(() => {
    const out: { path: string; name: string; folder: string }[] = [];
    flatten(tree, '', out);
    return out;
  }, [tree]);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? all.filter((f) => `${f.name} ${f.folder}`.toLowerCase().includes(s)) : all;
    return list.slice(0, 50);
  }, [q, all]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => setIdx(0), [q]);

  const choose = (i: number) => {
    const f = results[i];
    if (f) {
      onOpen(f.path);
      onClose();
    }
  };

  return (
    <div className="qo-backdrop" onMouseDown={onClose}>
      <div className="qo" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="qo-input"
          placeholder="파일 이름으로 빠르게 열기…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(results.length - 1, i + 1));
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
          {results.length === 0 ? (
            <div className="qo-empty">일치하는 파일이 없습니다</div>
          ) : (
            results.map((f, i) => (
              <button
                key={f.path}
                className={`qo-item${i === idx ? ' active' : ''}`}
                onMouseEnter={() => setIdx(i)}
                onClick={() => choose(i)}
              >
                <span className="qo-name">
                  <Icon name={f.path.endsWith('.md') ? 'note' : 'mindmap'} />
                  <span className="qo-name-txt">{f.name}</span>
                </span>
                {f.folder && <span className="qo-folder">{f.folder}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
